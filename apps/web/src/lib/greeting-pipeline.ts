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
  counts.processed = 1;

  const task = await context.store.createOrUpdateTask({
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
    modelProvider: "local",
    modelName: "template",
    templateVersion: context.template.version,
    estimatedCostCny: 0,
    failureReason: "",
    createdAt: toIsoString(context.now()),
    updatedAt: toIsoString(context.now())
  });

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
    await context.store.transitionTask(task.id, "rejected", {
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

  await context.store.transitionTask(task.id, "filtered");
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

  await context.store.transitionTask(task.id, "scored", {
    score: scoreResult.score,
    matchedRequirements: scoreResult.matchedRequirements,
    missingRequirements: scoreResult.missingRequirements,
    matchReasons: scoreResult.reasons,
    modelProvider: scoreResult.provider,
    modelName: scoreResult.model,
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
    await context.store.transitionTask(task.id, "rejected", {
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

  await context.store.transitionTask(task.id, "generated", {
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
  let finalProvider = scoreResult.provider;
  let finalModel = scoreResult.model;
  let finalCost = accumulatedScoreCost;

  try {
    const refineResult = await context.provider.refineGreeting({
      draft: localRendered,
      job,
      selectedProfileItems: [...selectedItems.skills, ...selectedItems.projects],
      template: context.template
    });
    finalText = validateGreetingText(refineResult.text, context.template);
    finalProvider = refineResult.provider;
    finalModel = refineResult.model;
    finalCost = roundCurrency(accumulatedScoreCost + refineResult.estimatedCostCny);
    counts.estimatedCostCny += roundCurrency(refineResult.estimatedCostCny);
  } catch (error) {
    await appendRunLog(context, {
      level: "warn",
      message: "润色失败，回退到本地模板草稿",
      jobId: job.id,
      taskId: task.id,
      detail: "refinement_fallback"
    });
    void error;
  }

  await context.store.transitionTask(task.id, "pending_review", {
    messageDraft: finalText,
    usedProfileItemIds,
    modelProvider: finalProvider,
    modelName: finalModel,
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
}

async function failTask(
  context: GreetingPipelineContext,
  taskId: string,
  jobId: string,
  error: unknown,
  counts: GreetingPipelineRunCounts,
  message: string
): Promise<GreetingPipelineRunCounts> {
  const failureReason = toErrorMessage(error);
  await context.store.transitionTask(taskId, "failed", {
    failureReason
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
