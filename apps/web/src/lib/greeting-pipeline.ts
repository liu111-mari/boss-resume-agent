import {
  evaluateJob,
  renderGreeting,
  selectProfileItems,
  type FilterConfig,
  type GreetingTask,
  type GreetingTaskStatus,
  type GreetingTemplate,
  type JobCard,
  type Profile
} from "@boss-agent/shared";

import { getDomainStore, type RunLogEntry } from "@/lib/domain-store";
import {
  createConfiguredProvider,
  type GreetingModelProvider,
  type ScoreJobResult
} from "@/lib/model-provider";
import { redactDiagnosticValue } from "@/lib/diagnostics";

type DomainStoreLike = ReturnType<typeof getDomainStore>;

type PipelineNow = () => string | Date;

export type GreetingPipelineRunCounts = {
  processed: number;
  hardRejected: number;
  scoreRejected: number;
  pendingReview: number;
  failed: number;
  estimatedCostCny: number;
};

type GreetingPipelineOptions = {
  store: DomainStoreLike;
  provider: GreetingModelProvider;
  now?: PipelineNow;
  concurrency?: number;
};

type GreetingPipelineContext = {
  config: FilterConfig;
  profile: Profile;
  template: GreetingTemplate;
  jobsById: Map<string, JobCard>;
  tasks: GreetingTask[];
  provider: GreetingModelProvider;
  store: DomainStoreLike;
  now: PipelineNow;
};

const NON_TERMINAL_TASK_STATUSES = new Set<GreetingTaskStatus>([
  "collected",
  "filtered",
  "scored",
  "generated",
  "pending_review",
  "approved",
  "sending",
  "paused",
  "quota_blocked"
]);
const FAILABLE_TASK_STATUSES = new Set<GreetingTaskStatus>([
  "collected",
  "filtered",
  "scored",
  "generated",
  "sending"
]);
const LOCAL_FALLBACK_PROVIDER = "local";
const LOCAL_FALLBACK_MODEL = "template";

export function createGreetingPipeline(options: GreetingPipelineOptions) {
  const concurrency = clampConcurrency(options.concurrency);
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async run(jobIds?: string[]): Promise<GreetingPipelineRunCounts> {
      const [config, profile, template, jobs, tasks] = await Promise.all([
        options.store.getConfig(),
        options.store.getProfile(),
        options.store.getTemplate(),
        options.store.getJobs(),
        options.store.getTasks()
      ]);

      const counts = createEmptyCounts();
      const context: GreetingPipelineContext = {
        config,
        profile,
        template,
        jobsById: new Map(jobs.map((job) => [job.id, job])),
        tasks,
        provider: options.provider,
        store: options.store,
        now
      };

      const requestedIds = jobIds ? unique(jobIds) : jobs.map((job) => job.id);
      const targets: JobCard[] = [];

      for (const jobId of requestedIds) {
        const job = context.jobsById.get(jobId);
        if (!job) {
          counts.failed += 1;
          await appendRunLog(context, {
            level: "error",
            message: "指定岗位不存在，已跳过",
            jobId,
            detail: "job_not_found"
          });
          continue;
        }

        if (hasNonTerminalTask(context.tasks, job.id)) {
          await appendRunLog(context, {
            level: "info",
            message: "岗位已有未完成任务，已跳过",
            jobId: job.id,
            detail: "active_task_exists"
          });
          continue;
        }

        targets.push(job);
      }

      const workerCount = Math.min(concurrency, Math.max(targets.length, 1));
      let cursor = 0;

      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (cursor < targets.length) {
            const current = targets[cursor];
            cursor += 1;
            const jobCounts = await processJob(context, current);
            mergeCounts(counts, jobCounts);
          }
        })
      );

      counts.estimatedCostCny = roundCurrency(counts.estimatedCostCny);
      return counts;
    }
  };
}

export async function runGreetingPipeline(jobIds?: string[]): Promise<GreetingPipelineRunCounts> {
  return createGreetingPipeline({
    store: getDomainStore(),
    provider: createConfiguredProvider()
  }).run(jobIds);
}

async function processJob(
  context: GreetingPipelineContext,
  job: JobCard
): Promise<GreetingPipelineRunCounts> {
  const counts = createEmptyCounts();
  let task: GreetingTask | null = null;

  try {
    task = await context.store.createTaskIfNoActiveJobTask({
      id: globalThis.crypto.randomUUID(),
      jobId: job.id,
      jobTitle: job.title,
      company: job.company,
      detailUrl: job.detailUrl ?? "",
      messageDraft: "",
      status: "collected",
      score: undefined,
      matchReasons: [],
      matchedRequirements: [],
      missingRequirements: [],
      usedProfileItemIds: [],
      modelProvider: LOCAL_FALLBACK_PROVIDER,
      modelName: LOCAL_FALLBACK_MODEL,
      scoringProvider: "",
      scoringModel: "",
      refinementProvider: "",
      refinementModel: "",
      refinementFallback: false,
      templateVersion: context.template.version,
      estimatedCostCny: 0,
      failureReason: "",
      createdAt: toIsoString(context.now()),
      updatedAt: toIsoString(context.now())
    });

    if (!task) {
      await appendRunLog(context, {
        level: "info",
        message: "岗位已有未完成任务，已跳过",
        jobId: job.id,
        detail: "active_task_exists"
      });
      return counts;
    }

    counts.processed = 1;

    await appendRunLog(context, {
      level: "info",
      message: "已收集岗位并创建流水线任务",
      jobId: job.id,
      taskId: task.id,
      detail: "collected"
    });

    const hardFilter = evaluateJob(job, context.config);
    if (!hardFilter.accepted) {
      const failureReason = hardFilter.reasons[0] ?? "硬筛未通过";
      task = await context.store.transitionTask(task.id, "rejected", {
        failureReason
      });
      await appendRunLog(context, {
        level: "info",
        message: "岗位未通过硬筛",
        jobId: job.id,
        taskId: task.id,
        detail: failureReason
      });
      counts.hardRejected += 1;
      return counts;
    }

    task = await context.store.transitionTask(task.id, "filtered");
    await appendRunLog(context, {
      level: "info",
      message: "岗位通过硬筛",
      jobId: job.id,
      taskId: task.id,
      detail: "filtered"
    });

    let scoreResult: ScoreJobResult;
    try {
      scoreResult = await context.provider.scoreJob({
        job,
        profile: context.profile,
        keywords: context.config.requiredKeywords
      });
    } catch (error) {
      return failTask(context, task.id, job.id, error, counts, "评分阶段失败");
    }

    const accumulatedScoreCost = roundCurrency(scoreResult.estimatedCostCny);
    counts.estimatedCostCny += accumulatedScoreCost;

    task = await context.store.transitionTask(task.id, "scored", {
      score: scoreResult.score,
      matchedRequirements: scoreResult.matchedRequirements,
      missingRequirements: scoreResult.missingRequirements,
      matchReasons: scoreResult.reasons,
      modelProvider: scoreResult.provider,
      modelName: scoreResult.model,
      scoringProvider: scoreResult.provider,
      scoringModel: scoreResult.model,
      refinementProvider: "",
      refinementModel: "",
      refinementFallback: false,
      estimatedCostCny: accumulatedScoreCost
    });
    await appendRunLog(context, {
      level: "info",
      message: "岗位完成模型评分",
      jobId: job.id,
      taskId: task.id,
      detail: `score=${scoreResult.score}`
    });

    if (scoreResult.score < context.config.scoreThreshold) {
      const failureReason = `评分低于阈值：${scoreResult.score} < ${context.config.scoreThreshold}`;
      task = await context.store.transitionTask(task.id, "rejected", {
        failureReason
      });
      await appendRunLog(context, {
        level: "info",
        message: "岗位因评分不足被拒绝",
        jobId: job.id,
        taskId: task.id,
        detail: failureReason
      });
      counts.scoreRejected += 1;
      return finalizeCounts(counts);
    }

    const selectionKeywords = unique([
      ...scoreResult.matchedRequirements,
      ...context.config.requiredKeywords
    ]);
    const selectedItems = selectProfileItems(context.profile, selectionKeywords, {
      maxSkills: context.template.maxSkills,
      maxProjects: context.template.maxProjects
    });
    const usedProfileItemIds = collectUsedProfileItemIds(context.profile, selectedItems);

    let localRendered: string;
    try {
      localRendered = renderGreeting({
        template: context.template,
        job,
        profile: context.profile,
        selectedItems,
        matchedRequirements: scoreResult.matchedRequirements
      });
    } catch (error) {
      return failTask(context, task.id, job.id, error, counts, "模板渲染失败");
    }

    task = await context.store.transitionTask(task.id, "generated", {
      messageDraft: localRendered,
      usedProfileItemIds,
      templateVersion: context.template.version,
      estimatedCostCny: accumulatedScoreCost
    });
    await appendRunLog(context, {
      level: "info",
      message: "已生成初始招呼语草稿",
      jobId: job.id,
      taskId: task.id,
      detail: "generated"
    });

    let finalText = localRendered;
    let finalProvider = LOCAL_FALLBACK_PROVIDER;
    let finalModel = LOCAL_FALLBACK_MODEL;
    let refinementProvider = LOCAL_FALLBACK_PROVIDER;
    let refinementModel = LOCAL_FALLBACK_MODEL;
    let refinementFallback = false;
    let finalCost = accumulatedScoreCost;

    try {
      const refineResult = await context.provider.refineGreeting({
        draft: localRendered,
        job,
        selectedProfileItems: [...selectedItems.skills, ...selectedItems.projects],
        template: context.template
      });
      const refinementCost = roundCurrency(refineResult.estimatedCostCny);
      counts.estimatedCostCny += refinementCost;
      finalCost = roundCurrency(accumulatedScoreCost + refinementCost);

      try {
        finalText = validateGreetingText(refineResult.text, context.template);
        finalProvider = refineResult.provider;
        finalModel = refineResult.model;
        refinementProvider = refineResult.provider;
        refinementModel = refineResult.model;
      } catch {
        refinementFallback = true;
        await appendRunLog(context, {
          level: "warn",
          message: "润色结果未通过校验，回退到本地模板草稿",
          jobId: job.id,
          taskId: task.id,
          detail: "refinement_fallback"
        });
      }
    } catch {
      refinementFallback = true;
      await appendRunLog(context, {
        level: "warn",
        message: "润色失败，回退到本地模板草稿",
        jobId: job.id,
        taskId: task.id,
        detail: "refinement_fallback"
      });
    }

    task = await context.store.transitionTask(task.id, "pending_review", {
      messageDraft: finalText,
      usedProfileItemIds,
      modelProvider: finalProvider,
      modelName: finalModel,
      scoringProvider: scoreResult.provider,
      scoringModel: scoreResult.model,
      refinementProvider,
      refinementModel,
      refinementFallback,
      templateVersion: context.template.version,
      estimatedCostCny: finalCost
    });
    await appendRunLog(context, {
      level: "info",
      message: "已生成待审核招呼语",
      jobId: job.id,
      taskId: task.id,
      detail: "pending_review"
    });

    counts.pendingReview += 1;
    return finalizeCounts(counts);
  } catch (error) {
    return handleUnexpectedJobError(context, job, task, error, counts);
  }
}

async function failTask(
  context: GreetingPipelineContext,
  taskId: string,
  jobId: string,
  error: unknown,
  counts: GreetingPipelineRunCounts,
  message: string
): Promise<GreetingPipelineRunCounts> {
  const failureReason = safeErrorDetail(error);
  const attemptedModel =
    error && typeof error === "object"
      ? {
          provider: "provider" in error && typeof error.provider === "string" ? error.provider : "",
          model: "model" in error && typeof error.model === "string" ? error.model : ""
        }
      : { provider: "", model: "" };
  const modelMetadata =
    attemptedModel.provider && attemptedModel.model
      ? {
          modelProvider: attemptedModel.provider,
          modelName: attemptedModel.model,
          scoringProvider: attemptedModel.provider,
          scoringModel: attemptedModel.model
        }
      : {};
  await context.store.transitionTask(taskId, "failed", {
    failureReason,
    ...modelMetadata
  });
  await appendRunLog(context, {
    level: "error",
    message,
    jobId,
    taskId,
    detail: failureReason
  });
  counts.failed += 1;
  return finalizeCounts(counts);
}

async function handleUnexpectedJobError(
  context: GreetingPipelineContext,
  job: JobCard,
  task: GreetingTask | null,
  error: unknown,
  counts: GreetingPipelineRunCounts
): Promise<GreetingPipelineRunCounts> {
  const detail = safeErrorDetail(error);
  counts.failed += 1;

  if (task && FAILABLE_TASK_STATUSES.has(task.status)) {
    try {
      await context.store.transitionTask(task.id, "failed", {
        failureReason: detail
      });
    } catch {
      // best effort only
    }
  }

  try {
    await appendRunLog(context, {
      level: "error",
      message: "岗位处理异常，已隔离并继续后续岗位",
      jobId: job.id,
      taskId: task?.id,
      detail
    });
  } catch {
    // best effort only
  }

  return finalizeCounts(counts);
}

async function appendRunLog(
  context: GreetingPipelineContext,
  input: Pick<RunLogEntry, "level" | "message"> &
    Partial<Pick<RunLogEntry, "taskId" | "jobId" | "detail">>
): Promise<void> {
  await context.store.appendRunLog({
    id: globalThis.crypto.randomUUID(),
    level: input.level,
    message: input.message,
    createdAt: toIsoString(context.now()),
    taskId: input.taskId,
    jobId: input.jobId,
    detail: input.detail
  });
}

function createEmptyCounts(): GreetingPipelineRunCounts {
  return {
    processed: 0,
    hardRejected: 0,
    scoreRejected: 0,
    pendingReview: 0,
    failed: 0,
    estimatedCostCny: 0
  };
}

function mergeCounts(
  target: GreetingPipelineRunCounts,
  next: GreetingPipelineRunCounts
): void {
  target.processed += next.processed;
  target.hardRejected += next.hardRejected;
  target.scoreRejected += next.scoreRejected;
  target.pendingReview += next.pendingReview;
  target.failed += next.failed;
  target.estimatedCostCny = roundCurrency(target.estimatedCostCny + next.estimatedCostCny);
}

function finalizeCounts(counts: GreetingPipelineRunCounts): GreetingPipelineRunCounts {
  return {
    ...counts,
    estimatedCostCny: roundCurrency(counts.estimatedCostCny)
  };
}

function hasNonTerminalTask(tasks: GreetingTask[], jobId: string): boolean {
  return tasks.some((task) => task.jobId === jobId && NON_TERMINAL_TASK_STATUSES.has(task.status));
}

function collectUsedProfileItemIds(
  profile: Profile,
  selectedItems: ReturnType<typeof selectProfileItems>
): string[] {
  const introItemId =
    selectedItems.selfIntro.length > 0
      ? profile.items.find(
          (item) =>
            item.enabled && item.category === "intro" && item.content === selectedItems.selfIntro
        )?.id
      : undefined;

  return unique(
    [
      introItemId,
      ...selectedItems.skills.map((item) => item.id),
      ...selectedItems.projects.map((item) => item.id)
    ].filter((value): value is string => typeof value === "string" && value.length > 0)
  );
}

function validateGreetingText(text: string, template: GreetingTemplate): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length < template.minLength || normalized.length > template.maxLength) {
    throw new Error("生成话术长度不符合要求");
  }

  const bannedPhrase = template.bannedPhrases.find((phrase) =>
    normalized.normalize("NFKC").toLocaleLowerCase().includes(phrase.normalize("NFKC").toLocaleLowerCase())
  );
  if (bannedPhrase) {
    throw new Error(`命中禁用表达：${bannedPhrase}`);
  }

  return normalized;
}

function clampConcurrency(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 3;
  }

  return Math.min(3, Math.max(1, Math.floor(value)));
}

function toIsoString(input: string | Date): string {
  return typeof input === "string" ? new Date(input).toISOString() : input.toISOString();
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function roundCurrency(value: number): number {
  return Number(value.toFixed(4));
}

function safeErrorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : "未知错误";
  const redactedMessage = redactDiagnosticValue({ message });
  const raw =
    redactedMessage &&
    typeof redactedMessage === "object" &&
    "message" in redactedMessage &&
    typeof redactedMessage.message === "string"
      ? redactedMessage.message
      : "未知错误";

  return raw
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/api_key\s*=\s*([^\s&]+)/gi, "api_key=[REDACTED]")
    .slice(0, 500);
}
