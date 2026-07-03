import path from "node:path";

import {
  filterConfigSchema,
  greetingTaskSchema,
  greetingTemplateSchema,
  inferDirection,
  jobCardSchema,
  preferenceFeedbackSchema,
  preferenceRuleSchema,
  preferenceSuggestionBatchSchema,
  profileSchema,
  createDefaultPreferenceRules,
  type FilterConfig,
  type GreetingTask,
  type GreetingTaskStatus,
  type GreetingTemplate,
  type JobCard,
  type PreferenceFeedback,
  type PreferenceFocusField,
  type PreferenceRule,
  type PreferenceSuggestionBatch,
  type Profile
} from "@boss-agent/shared";
import { z } from "zod";

import { withFilesystemLock } from "@/lib/filesystem-lock";
import { JsonRepository } from "@/lib/local-repository";

const runLogEntrySchema = z.object({
  id: z.string(),
  level: z.enum(["info", "warn", "error"]),
  message: z.string().min(1),
  createdAt: z.string(),
  taskId: z.string().optional(),
  jobId: z.string().optional(),
  detail: z.string().optional()
});

const dailyUsageSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  confirmedSends: z.number().int().nonnegative().default(0),
  failures: z.number().int().nonnegative().default(0),
  modelCalls: z.number().int().nonnegative().default(0),
  estimatedCostCny: z.number().nonnegative().default(0),
  pausedReason: z.string().default(""),
  updatedAt: z.string()
});

const runLogListSchema = z.array(runLogEntrySchema);
const dailyUsageListSchema = z.array(dailyUsageSchema);
const baseDirMutationQueues = new Map<string, Promise<unknown>>();
const domainStoreCache = new Map<string, ReturnType<typeof createDomainStore>>();

const defaultTemplate = greetingTemplateSchema.parse({
  body:
    "BOSS您好，我对您发布的{{jobTitle}}岗位很感兴趣。{{selfIntro}}主要工作或项目内容包括：{{projects}}。我的岗位匹配优势包括：{{matchedRequirements}}。相关技能包括：{{skills}}。详细情况您可以看下我的简历，期待您的回复！",
  tone: "专业自然",
  minLength: 30,
  maxLength: 220,
  maxSkills: 4,
  maxProjects: 3,
  bannedPhrases: ["海投", "群发"],
  version: 2
});

const taskTransitionMap: Record<GreetingTaskStatus, readonly GreetingTaskStatus[]> = {
  collected: ["filtered", "rejected", "failed"],
  filtered: ["scored", "rejected", "failed"],
  scored: ["generated", "rejected", "failed"],
  generated: ["pending_review", "failed"],
  pending_review: ["approved", "rejected"],
  approved: ["sending", "rejected", "quota_blocked"],
  sending: ["failed", "paused", "quota_blocked"],
  paused: ["approved", "rejected"],
  quota_blocked: ["approved", "rejected"],
  sent: [],
  rejected: [],
  failed: []
};
const defaultNonTerminalTaskStatuses = [
  "collected",
  "filtered",
  "scored",
  "generated",
  "pending_review",
  "approved",
  "sending",
  "paused",
  "quota_blocked"
] as const satisfies readonly GreetingTaskStatus[];

export type RunLogEntry = z.infer<typeof runLogEntrySchema>;
export type DailyUsage = z.infer<typeof dailyUsageSchema>;

export type JobRemovalResult = {
  removedJobIds: string[];
  blockedJobIds: string[];
  canceledTaskIds: string[];
};

export type RecordJobFeedbackInput = {
  jobIds: string[];
  label: "positive" | "negative";
  remove: boolean;
  focusFields: PreferenceFocusField[];
  note: string;
};

export type PreferenceState = {
  feedback: PreferenceFeedback[];
  rules: PreferenceRule[];
  ruleHistory: PreferenceRule[];
  suggestions: PreferenceSuggestionBatch[];
  newFeedbackCount: number;
};

export class DomainTransitionError extends Error {
  constructor(
    public readonly from: GreetingTaskStatus,
    public readonly to: GreetingTaskStatus
  ) {
    super(`Illegal task transition: ${from} -> ${to}`);
    this.name = "DomainTransitionError";
  }
}

export class DomainEntityNotFoundError extends Error {
  constructor(
    public readonly entityType: "task",
    public readonly entityId: string
  ) {
    super(`${entityType} not found: ${entityId}`);
    this.name = "DomainEntityNotFoundError";
  }
}

export class DomainConflictError extends Error {
  constructor(
    public readonly entityType: "task",
    public readonly entityId: string,
    public readonly expectedUpdatedAt: string,
    public readonly actualUpdatedAt: string
  ) {
    super(`${entityType} conflict: ${entityId}`);
    this.name = "DomainConflictError";
  }
}

export class DomainQuotaExceededError extends Error {
  constructor(
    public readonly date: string,
    public readonly used: number,
    public readonly limit: number
  ) {
    super(`Daily confirmed-send quota reached: ${used}/${limit}`);
    this.name = "DomainQuotaExceededError";
  }
}

export function getShanghaiDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function resolveDomainStoreBaseDir(
  baseDir = process.env.BOSS_AGENT_DATA_DIR ?? path.join(process.cwd(), ".boss-agent-data")
): string {
  return path.resolve(baseDir);
}

export function createDomainStore(
  baseDir = process.env.BOSS_AGENT_DATA_DIR ?? path.join(process.cwd(), ".boss-agent-data")
) {
  const resolvedBaseDir = resolveDomainStoreBaseDir(baseDir);
  const repositories = {
    config: new JsonRepository(path.join(resolvedBaseDir, "config.json"), filterConfigSchema, filterConfigSchema.parse({})),
    profile: new JsonRepository(path.join(resolvedBaseDir, "profile.json"), profileSchema, profileSchema.parse({})),
    template: new JsonRepository(path.join(resolvedBaseDir, "template.json"), greetingTemplateSchema, defaultTemplate),
    jobs: new JsonRepository(path.join(resolvedBaseDir, "jobs.json"), z.array(jobCardSchema), []),
    tasks: new JsonRepository(path.join(resolvedBaseDir, "tasks.json"), z.array(greetingTaskSchema), []),
    runLogs: new JsonRepository(path.join(resolvedBaseDir, "run-logs.json"), runLogListSchema, []),
    dailyUsage: new JsonRepository(path.join(resolvedBaseDir, "daily-usage.json"), dailyUsageListSchema, []),
    sentJobs: new JsonRepository(
      path.join(resolvedBaseDir, "sent-jobs.json"),
      z.array(z.object({ job: jobCardSchema, taskId: z.string(), sentAt: z.string() })),
      []
    ),
    preferenceFeedback: new JsonRepository(
      path.join(resolvedBaseDir, "preference-feedback.json"),
      z.array(preferenceFeedbackSchema),
      []
    ),
    preferenceRules: new JsonRepository(
      path.join(resolvedBaseDir, "preference-rules.json"),
      z.array(preferenceRuleSchema),
      createDefaultPreferenceRules()
    ),
    preferenceRuleHistory: new JsonRepository(
      path.join(resolvedBaseDir, "preference-rule-history.json"),
      z.array(preferenceRuleSchema),
      []
    ),
    preferenceSuggestions: new JsonRepository(
      path.join(resolvedBaseDir, "preference-suggestions.json"),
      z.array(preferenceSuggestionBatchSchema),
      []
    )
  };

  function queueMutation<T>(_key: string, mutate: () => Promise<T>): Promise<T> {
    const previous = baseDirMutationQueues.get(resolvedBaseDir) ?? Promise.resolve();
    const operation = previous.then(
      // proper-lockfile locks the directory by creating `${resolvedBaseDir}.lock`.
      () => withFilesystemLock(resolvedBaseDir, mutate, { lockType: "directory" }),
      () => withFilesystemLock(resolvedBaseDir, mutate, { lockType: "directory" })
    );
    baseDirMutationQueues.set(
      resolvedBaseDir,
      operation.then(
        () => undefined,
        () => undefined
      )
    );
    return operation;
  }

  async function getConfig(): Promise<FilterConfig> {
    return repositories.config.read();
  }

  async function saveConfig(input: unknown): Promise<FilterConfig> {
    return repositories.config.write(filterConfigSchema.parse(input));
  }

  async function getProfile(): Promise<Profile> {
    return repositories.profile.read();
  }

  async function saveProfile(input: unknown): Promise<Profile> {
    return repositories.profile.write(profileSchema.parse(input));
  }

  async function getTemplate(): Promise<GreetingTemplate> {
    return repositories.template.read();
  }

  async function saveTemplate(input: unknown): Promise<GreetingTemplate> {
    return repositories.template.write(greetingTemplateSchema.parse(input));
  }

  async function getJobs(): Promise<JobCard[]> {
    return repositories.jobs.read();
  }

  async function upsertJobs(input: unknown[]): Promise<JobCard[]> {
    return queueMutation("jobs", async () => {
      const jobs = await repositories.jobs.read();
      const parsed = input.map((item) => {
        const candidate = jobCardSchema.parse(item);
        const text = `${candidate.title} ${candidate.company} ${candidate.jdText}`;
        return {
          ...candidate,
          direction: inferDirection(text)
        };
      });

      for (const job of parsed) {
        const existingIndex = jobs.findIndex(
          (item) => item.id === job.id || (job.detailUrl && item.detailUrl === job.detailUrl)
        );

        if (existingIndex >= 0) {
          jobs[existingIndex] = mergeCollectedJob(jobs[existingIndex], job);
        } else {
          jobs.unshift(job);
        }
      }

      return repositories.jobs.write(jobs);
    });
  }

  async function deleteJob(jobId: string): Promise<void> {
    return queueMutation("jobs", async () => {
      const jobs = await repositories.jobs.read();
      const filtered = jobs.filter((j) => j.id !== jobId);
      if (filtered.length === jobs.length) return; // 没有变化
      await repositories.jobs.write(filtered);
    });
  }

  async function getPreferenceState(): Promise<PreferenceState> {
    const [feedback, rules, ruleHistory, suggestions] = await Promise.all([
      repositories.preferenceFeedback.read(),
      repositories.preferenceRules.read(),
      repositories.preferenceRuleHistory.read(),
      repositories.preferenceSuggestions.read()
    ]);
    return {
      feedback,
      rules,
      ruleHistory,
      suggestions,
      newFeedbackCount: feedback.filter(
        (item) => item.active && item.consumedBySuggestionIds.length === 0
      ).length
    };
  }

  async function recordJobFeedback(input: RecordJobFeedbackInput): Promise<
    JobRemovalResult & { feedback: PreferenceFeedback[] }
  > {
    return queueMutation("preferences", async () => {
      const parsedInput = z.object({
        jobIds: z.array(z.string()).min(1),
        label: z.enum(["positive", "negative"]),
        remove: z.boolean(),
        focusFields: z.array(z.enum(["title", "industry", "jdResponsibilities", "jdRequirements", "other"])),
        note: z.string()
      }).parse(input);
      const jobs = await repositories.jobs.read();
      const tasks = await repositories.tasks.read();
      const existingFeedback = await repositories.preferenceFeedback.read();
      const jobIds = Array.from(new Set(parsedInput.jobIds));
      const removal = parsedInput.remove
        ? buildRemovalMutation(jobs, tasks, jobIds)
        : { nextJobs: jobs, nextTasks: tasks, removedJobIds: [], blockedJobIds: [], canceledTaskIds: [] };
      const acceptedJobIds = new Set(
        parsedInput.remove
          ? removal.removedJobIds
          : jobIds.filter((jobId) => jobs.some((job) => job.id === jobId))
      );
      const now = new Date().toISOString();
      const nextFeedback = existingFeedback.map((item) =>
        acceptedJobIds.has(item.jobId) && item.active
          ? preferenceFeedbackSchema.parse({ ...item, active: false, updatedAt: now })
          : item
      );
      const created = jobs
        .filter((job) => acceptedJobIds.has(job.id))
        .map((job) => preferenceFeedbackSchema.parse({
          id: globalThis.crypto.randomUUID(),
          jobId: job.id,
          jobSnapshot: job,
          label: parsedInput.label,
          focusFields: parsedInput.focusFields,
          note: parsedInput.note.trim(),
          active: true,
          source: parsedInput.label === "positive" ? "favorite" : "negative_remove",
          consumedBySuggestionIds: [],
          createdAt: now,
          updatedAt: now
        }));

      await repositories.preferenceFeedback.write([...nextFeedback, ...created]);
      if (parsedInput.remove) {
        await repositories.tasks.write(removal.nextTasks);
        await repositories.jobs.write(removal.nextJobs);
      }
      return {
        feedback: created,
        removedJobIds: removal.removedJobIds,
        blockedJobIds: removal.blockedJobIds,
        canceledTaskIds: removal.canceledTaskIds
      };
    });
  }

  async function removeJobs(jobIds: string[]): Promise<JobRemovalResult> {
    return queueMutation("jobs", async () => {
      const jobs = await repositories.jobs.read();
      const tasks = await repositories.tasks.read();
      const mutation = buildRemovalMutation(jobs, tasks, Array.from(new Set(jobIds)));
      await repositories.tasks.write(mutation.nextTasks);
      await repositories.jobs.write(mutation.nextJobs);
      return {
        removedJobIds: mutation.removedJobIds,
        blockedJobIds: mutation.blockedJobIds,
        canceledTaskIds: mutation.canceledTaskIds
      };
    });
  }

  async function undoPreferenceFeedback(feedbackId: string): Promise<{
    feedback: PreferenceFeedback;
    restoredJob: JobCard | null;
  }> {
    return queueMutation("preferences", async () => {
      const feedback = await repositories.preferenceFeedback.read();
      const index = feedback.findIndex((item) => item.id === feedbackId && item.active);
      if (index < 0) throw new Error("preference_feedback_not_found");
      const now = new Date().toISOString();
      const next = preferenceFeedbackSchema.parse({
        ...feedback[index],
        active: false,
        updatedAt: now
      });
      feedback[index] = next;
      await repositories.preferenceFeedback.write(feedback);

      let restoredJob: JobCard | null = null;
      if (next.source === "negative_remove") {
        const jobs = await repositories.jobs.read();
        if (!jobs.some((job) => job.id === next.jobId)) {
          restoredJob = next.jobSnapshot;
          await repositories.jobs.write([restoredJob, ...jobs]);
        }
      }
      return { feedback: next, restoredJob };
    });
  }

  async function savePreferenceRules(input: unknown): Promise<PreferenceRule[]> {
    return queueMutation("preferences", async () => {
      const nextRules = z.array(preferenceRuleSchema).parse(input);
      const [currentRules, history] = await Promise.all([
        repositories.preferenceRules.read(),
        repositories.preferenceRuleHistory.read()
      ]);
      const nextById = new Map(nextRules.map((rule) => [rule.id, rule]));
      const nextHistory = [...history];
      for (const current of currentRules) {
        const next = nextById.get(current.id);
        if ((!next || JSON.stringify(next) !== JSON.stringify(current)) &&
          !nextHistory.some((item) => item.id === current.id && item.version === current.version)) {
          nextHistory.push(current);
        }
      }
      await repositories.preferenceRuleHistory.write(nextHistory);
      return repositories.preferenceRules.write(nextRules);
    });
  }

  async function restorePreferenceRuleVersion(ruleId: string, version: number): Promise<PreferenceRule> {
    return queueMutation("preferences", async () => {
      const [rules, history] = await Promise.all([
        repositories.preferenceRules.read(),
        repositories.preferenceRuleHistory.read()
      ]);
      const target = history.find((item) => item.id === ruleId && item.version === version)
        ?? rules.find((item) => item.id === ruleId && item.version === version);
      if (!target) throw new Error("preference_rule_version_not_found");

      const current = rules.find((item) => item.id === ruleId);
      const nextHistory = [...history];
      if (current && !nextHistory.some((item) => item.id === current.id && item.version === current.version)) {
        nextHistory.push(current);
      }
      const versions = history.filter((item) => item.id === ruleId).map((item) => item.version);
      const restored = preferenceRuleSchema.parse({
        ...target,
        provenance: "manual",
        version: Math.max(target.version, current?.version ?? 0, ...versions) + 1,
        updatedAt: new Date().toISOString()
      });
      const nextRules = rules.filter((item) => item.id !== ruleId);
      nextRules.push(restored);
      await repositories.preferenceRuleHistory.write(nextHistory);
      await repositories.preferenceRules.write(nextRules);
      return restored;
    });
  }

  async function saveSuggestionBatch(input: unknown): Promise<PreferenceSuggestionBatch> {
    return queueMutation("preferences", async () => {
      const batch = preferenceSuggestionBatchSchema.parse(input);
      const suggestions = await repositories.preferenceSuggestions.read();
      const nextSuggestions = suggestions.filter((item) => item.id !== batch.id);
      nextSuggestions.push(batch);
      await repositories.preferenceSuggestions.write(nextSuggestions);

      const consumedIds = new Set(batch.feedbackIds);
      if (consumedIds.size > 0) {
        const feedback = await repositories.preferenceFeedback.read();
        await repositories.preferenceFeedback.write(feedback.map((item) =>
          consumedIds.has(item.id) && !item.consumedBySuggestionIds.includes(batch.id)
            ? preferenceFeedbackSchema.parse({
                ...item,
                consumedBySuggestionIds: [...item.consumedBySuggestionIds, batch.id],
                updatedAt: batch.updatedAt
              })
            : item
        ));
      }
      return batch;
    });
  }

  async function updateSuggestionBatch(
    batchId: string,
    patch: Partial<Pick<PreferenceSuggestionBatch, "status" | "updatedAt">>
  ): Promise<PreferenceSuggestionBatch> {
    return queueMutation("preferences", async () => {
      const suggestions = await repositories.preferenceSuggestions.read();
      const index = suggestions.findIndex((item) => item.id === batchId);
      if (index < 0) throw new Error("preference_suggestion_not_found");
      const next = preferenceSuggestionBatchSchema.parse({ ...suggestions[index], ...patch });
      suggestions[index] = next;
      await repositories.preferenceSuggestions.write(suggestions);
      return next;
    });
  }

  function buildRemovalMutation(jobs: JobCard[], tasks: GreetingTask[], jobIds: string[]) {
    const requested = new Set(jobIds);
    const blockedJobIds = jobIds.filter((jobId) =>
      tasks.some((task) => task.jobId === jobId && task.status === "sending")
    );
    const blocked = new Set(blockedJobIds);
    const removable = new Set(jobIds.filter((jobId) =>
      !blocked.has(jobId) && jobs.some((job) => job.id === jobId)
    ));
    const canceledTaskIds: string[] = [];
    const now = new Date().toISOString();
    const nextTasks = tasks.map((task) => {
      if (!removable.has(task.jobId)) return task;
      const allowed = taskTransitionMap[task.status];
      const nextStatus = allowed.includes("rejected")
        ? "rejected"
        : allowed.includes("failed")
          ? "failed"
          : null;
      if (!nextStatus) return task;
      canceledTaskIds.push(task.id);
      return greetingTaskSchema.parse({
        ...task,
        status: nextStatus,
        failureReason: "user_removed_job",
        updatedAt: now
      });
    });
    return {
      nextJobs: jobs.filter((job) => !removable.has(job.id)),
      nextTasks,
      removedJobIds: jobs.filter((job) => requested.has(job.id) && removable.has(job.id)).map((job) => job.id),
      blockedJobIds,
      canceledTaskIds
    };
  }

  async function writeSentJob(job: JobCard, taskId: string, sentAt: string): Promise<void> {
    return queueMutation("sent-jobs", async () => {
      const entries = await repositories.sentJobs.read();
      entries.push({ job, taskId, sentAt });
      await repositories.sentJobs.write(entries);
    });
  }

  async function getSentJobs(): Promise<
    Array<{ job: JobCard; taskId: string; sentAt: string }>
  > {
    return repositories.sentJobs.read();
  }

  async function recordSentJobAndCleanup(
    jobId: string,
    taskId: string,
    sentAt: string
  ): Promise<void> {
    const jobs = await repositories.jobs.read();
    const job = jobs.find((j) => j.id === jobId);
    if (job) {
      const entries = await repositories.sentJobs.read();
      entries.push({ job, taskId, sentAt });
      await repositories.sentJobs.write(entries);
    }
    const filtered = jobs.filter((j) => j.id !== jobId);
    if (filtered.length < jobs.length) {
      await repositories.jobs.write(filtered);
    }
  }

  async function getTasks(): Promise<GreetingTask[]> {
    return repositories.tasks.read();
  }

  async function createOrUpdateTask(input: unknown): Promise<GreetingTask> {
    return queueMutation("tasks", async () => {
      const parsed = greetingTaskSchema.parse(input);
      const tasks = await repositories.tasks.read();
      const existingIndex = tasks.findIndex((task) => task.id === parsed.id);

      if (existingIndex < 0) {
        tasks.unshift(parsed);
        await repositories.tasks.write(tasks);
        return parsed;
      }

      const existing = tasks[existingIndex];
      const changed = hasTaskChanged(existing, parsed);
      if (!changed) {
        return existing;
      }

      const updated = greetingTaskSchema.parse({
        ...existing,
        ...parsed,
        updatedAt: new Date().toISOString()
      });
      tasks[existingIndex] = updated;
      await repositories.tasks.write(tasks);
      return updated;
    });
  }

  async function createTaskIfNoActiveJobTask(
    input: unknown,
    nonTerminalStatuses: readonly GreetingTaskStatus[] = defaultNonTerminalTaskStatuses
  ): Promise<GreetingTask | null> {
    return queueMutation("tasks", async () => {
      const parsed = greetingTaskSchema.parse(input);
      const tasks = await repositories.tasks.read();
      const hasActiveJobTask = tasks.some(
        (task) => task.jobId === parsed.jobId && nonTerminalStatuses.includes(task.status)
      );
      if (hasActiveJobTask) {
        return null;
      }

      const existingIndex = tasks.findIndex((task) => task.id === parsed.id);
      if (existingIndex >= 0) {
        throw new Error(`task already exists: ${parsed.id}`);
      }

      tasks.unshift(parsed);
      await repositories.tasks.write(tasks);
      return parsed;
    });
  }

  async function transitionTask(
    taskId: string,
    to: GreetingTaskStatus,
    metadata: Partial<Omit<GreetingTask, "id" | "createdAt" | "updatedAt" | "status">> = {}
  ): Promise<GreetingTask> {
    return queueMutation("tasks", async () => {
      const tasks = await repositories.tasks.read();
      const index = tasks.findIndex((task) => task.id === taskId);
      if (index < 0) {
        throw new DomainEntityNotFoundError("task", taskId);
      }

      const current = tasks[index];
      const allowed = taskTransitionMap[current.status];
      if (!allowed.includes(to)) {
        throw new DomainTransitionError(current.status, to);
      }

      const nextCandidate = greetingTaskSchema.parse({
        ...current,
        ...metadata,
        status: to,
        updatedAt: new Date().toISOString()
      });

      if (!hasTaskChanged(current, nextCandidate)) {
        return current;
      }

      tasks[index] = nextCandidate;
      await repositories.tasks.write(tasks);
      return nextCandidate;
    });
  }

  async function updateTaskDraft(
    taskId: string,
    messageDraft: string,
    expectedUpdatedAt: string
  ): Promise<GreetingTask> {
    return queueMutation("tasks", async () => {
      const tasks = await repositories.tasks.read();
      const index = tasks.findIndex((task) => task.id === taskId);
      if (index < 0) {
        throw new DomainEntityNotFoundError("task", taskId);
      }

      const current = tasks[index];
      if (current.status !== "pending_review") {
        throw new DomainTransitionError(current.status, current.status);
      }

      if (current.updatedAt !== expectedUpdatedAt) {
        throw new DomainConflictError("task", taskId, expectedUpdatedAt, current.updatedAt);
      }

      const next = greetingTaskSchema.parse({
        ...current,
        messageDraft: messageDraft.trim(),
        updatedAt: new Date().toISOString()
      });

      if (!hasTaskChanged(current, next)) {
        return current;
      }

      tasks[index] = next;
      await repositories.tasks.write(tasks);
      return next;
    });
  }

  async function approveTasks(taskIds: string[]): Promise<GreetingTask[]> {
    return mutateTasksAtomically(taskIds, "approved");
  }

  async function rejectTasks(taskIds: string[], failureReason = ""): Promise<GreetingTask[]> {
    return queueMutation("tasks", async () => {
      const result = await mutateTasksAtomicallyInternal(taskIds, "rejected", { failureReason });

      // 清理岗位：每个被拒绝的任务对应的岗位，如果该岗位没有其他活跃任务，就从岗位库删除
      const allTasks = await repositories.tasks.read();
      let allJobs = await repositories.jobs.read();
      const rejectedJobIds = new Set(result.map((t) => t.jobId));

      for (const jobId of rejectedJobIds) {
        const hasOtherActive = allTasks.some(
          (t) =>
            t.jobId === jobId &&
            !taskIds.includes(t.id) &&
            (defaultNonTerminalTaskStatuses as readonly string[]).includes(t.status)
        );
        if (!hasOtherActive) {
          const nextJobs = allJobs.filter((j) => j.id !== jobId);
          if (nextJobs.length < allJobs.length) {
            await repositories.jobs.write(nextJobs);
            allJobs = nextJobs;
          }
        }
      }

      return result;
    });
  }

  async function getApprovedTasks(): Promise<GreetingTask[]> {
    const tasks = await repositories.tasks.read();
    return tasks.filter((task) => task.status === "approved");
  }

  async function claimApprovedTasksWithinQuota(date = getShanghaiDateKey(), maxTasks = 1) {
    return queueMutation("claim-approved", async () => {
      const [tasks, usage, config] = await Promise.all([
        repositories.tasks.read(),
        repositories.dailyUsage.read(),
        repositories.config.read()
      ]);
      const now = new Date();
      let tasksChanged = false;
      for (let index = 0; index < tasks.length; index += 1) {
        const task = tasks[index];
        if (
          task.status === "sending" &&
          getSendLeaseExpiry(task).getTime() <= now.getTime() &&
          !task.confirmationEvidence
        ) {
          tasks[index] = greetingTaskSchema.parse({
            ...task,
            status: "paused",
            quotaReservationDate: undefined,
            sendLeaseExpiresAt: undefined,
            failureReason: "send_lease_expired_manual_review",
            updatedAt: now.toISOString()
          });
          tasksChanged = true;
        }
      }
      const currentUsage = mergeConfirmedTaskUsage(
        usage.find((item) => item.date === date) ?? createDefaultDailyUsage(date),
        tasks
      );
      const approved = tasks.filter((task) => task.status === "approved");
      const reserved = tasks.filter(
        (task) =>
          task.status === "sending" &&
          getSendLeaseExpiry(task).getTime() > now.getTime() &&
          (task.quotaReservationDate ?? getShanghaiDateKey(new Date(task.updatedAt))) === date
      ).length;
      const available = Math.max(config.dailyLimit - currentUsage.confirmedSends - reserved, 0);
      const claimLimit = Math.max(0, Math.min(Math.trunc(maxTasks), available));
      const selectedIds = new Set(approved.slice(0, claimLimit).map((task) => task.id));
      const nowIso = now.toISOString();
      const leaseExpiresAt = new Date(now.getTime() + 2 * 60_000).toISOString();
      const claimed: GreetingTask[] = [];

      if (selectedIds.size > 0) {
        for (let index = 0; index < tasks.length; index += 1) {
          if (!selectedIds.has(tasks[index].id)) continue;
          const next = greetingTaskSchema.parse({
            ...tasks[index],
            status: "sending",
            quotaReservationDate: date,
            sendLeaseExpiresAt: leaseExpiresAt,
            failureReason: "",
            updatedAt: nowIso
          });
          tasks[index] = next;
          claimed.push(next);
          tasksChanged = true;
        }
      }
      if (tasksChanged) {
        await repositories.tasks.write(tasks);
      }

      const totalReserved = reserved + claimed.length;
      const remaining = Math.max(config.dailyLimit - currentUsage.confirmedSends - totalReserved, 0);
      return {
        tasks: claimed,
        approvedCount: approved.length,
        quota: {
          date,
          used: currentUsage.confirmedSends,
          limit: config.dailyLimit,
          reserved: totalReserved,
          remaining,
          blocked: claimed.length === 0 && remaining === 0,
          usage: currentUsage,
          config
        }
      };
    });
  }

  async function getDailyUsage(date: string): Promise<DailyUsage> {
    const [usage, tasks] = await Promise.all([
      repositories.dailyUsage.read(),
      repositories.tasks.read()
    ]);
    return mergeConfirmedTaskUsage(
      usage.find((item) => item.date === date) ?? createDefaultDailyUsage(date),
      tasks
    );
  }

  async function getDailyUsageHistory(): Promise<DailyUsage[]> {
    const [usage, tasks] = await Promise.all([
      repositories.dailyUsage.read(),
      repositories.tasks.read()
    ]);
    const dates = new Set([
      ...usage.map((item) => item.date),
      ...tasks
        .filter((task) => task.status === "sent" && task.sentAt)
        .map((task) => getShanghaiDateKey(new Date(task.sentAt!)))
    ]);
    return Array.from(dates)
      .sort()
      .reverse()
      .map((date) =>
        mergeConfirmedTaskUsage(
          usage.find((item) => item.date === date) ?? createDefaultDailyUsage(date),
          tasks
        )
      );
  }

  async function incrementConfirmedSend(date: string): Promise<DailyUsage> {
    return queueMutation("daily-usage", async () => {
      const usage = await repositories.dailyUsage.read();
      const index = usage.findIndex((item) => item.date === date);
      const current = index >= 0 ? usage[index] : createDefaultDailyUsage(date);
      const next = dailyUsageSchema.parse({
        ...current,
        confirmedSends: current.confirmedSends + 1,
        updatedAt: new Date().toISOString()
      });

      if (index >= 0) {
        usage[index] = next;
      } else {
        usage.unshift(next);
      }

      await repositories.dailyUsage.write(usage);
      return next;
    });
  }

  async function confirmTaskSent(
    taskId: string,
    confirmationEvidence: string,
    date = getShanghaiDateKey()
  ): Promise<GreetingTask> {
    const evidence = confirmationEvidence.trim();
    if (!evidence) {
      throw new Error("confirmation evidence is required");
    }

    return queueMutation("confirmed-send", async () => {
      const tasks = await repositories.tasks.read();
      const taskIndex = tasks.findIndex((task) => task.id === taskId);
      if (taskIndex < 0) {
        throw new DomainEntityNotFoundError("task", taskId);
      }

      const currentTask = tasks[taskIndex];
      if (
        currentTask.status === "sent" &&
        currentTask.confirmationEvidence === evidence
      ) {
        return currentTask;
      }
      if (
        currentTask.status === "paused" &&
        currentTask.confirmationEvidence === evidence
      ) {
        const now = new Date().toISOString();
        const reconciled = greetingTaskSchema.parse({
          ...currentTask,
          status: "sent",
          sentAt: currentTask.sentAt || now,
          sendLeaseExpiresAt: undefined,
          failureReason: "",
          updatedAt: now
        });
        tasks[taskIndex] = reconciled;
        await repositories.tasks.write(tasks);

        // 写入发送历史 + 删除岗位（paused→sent 路径）
        await recordSentJobAndCleanup(currentTask.jobId, currentTask.id, now);

        return reconciled;
      }
      if (currentTask.status !== "sending") {
        throw new DomainTransitionError(currentTask.status, "sent");
      }
      const confirmationDate = currentTask.quotaReservationDate ?? date;
      if (!confirmationDate) {
        throw new Error("send reservation is not valid for the confirmation date");
      }

      const now = new Date().toISOString();
      const sentTask = greetingTaskSchema.parse({
        ...currentTask,
        status: "sent",
        confirmationEvidence: evidence,
        sentAt: now,
        sendLeaseExpiresAt: undefined,
        failureReason: "",
        updatedAt: now
      });

      tasks[taskIndex] = sentTask;
      await repositories.tasks.write(tasks);

      // 写入发送历史 + 删除岗位（sending→sent 路径）
      await recordSentJobAndCleanup(currentTask.jobId, currentTask.id, now);

      return sentTask;
    });
  }

  async function refreshTaskSendReservation(
    taskId: string,
    date = getShanghaiDateKey()
  ): Promise<GreetingTask> {
    return queueMutation("refresh-send-reservation", async () => {
      const [tasks, usage, config] = await Promise.all([
        repositories.tasks.read(),
        repositories.dailyUsage.read(),
        repositories.config.read()
      ]);
      const index = tasks.findIndex((task) => task.id === taskId);
      if (index < 0) throw new DomainEntityNotFoundError("task", taskId);
      const current = tasks[index];
      if (current.status !== "approved" && current.status !== "sending") {
        throw new DomainTransitionError(current.status, "sending");
      }

      const currentUsage = mergeConfirmedTaskUsage(
        usage.find((item) => item.date === date) ?? createDefaultDailyUsage(date),
        tasks
      );
      const otherReservations = tasks.filter(
        (task) =>
          task.id !== taskId &&
          task.status === "sending" &&
          task.quotaReservationDate === date
      ).length;
      if (currentUsage.confirmedSends + otherReservations >= config.dailyLimit) {
        tasks[index] = greetingTaskSchema.parse({
          ...current,
          status: "quota_blocked",
          failureReason: "daily_quota_reached",
          updatedAt: new Date().toISOString()
        });
        await repositories.tasks.write(tasks);
        throw new DomainQuotaExceededError(date, currentUsage.confirmedSends, config.dailyLimit);
      }

      const next = greetingTaskSchema.parse({
        ...current,
        status: "sending",
        quotaReservationDate: date,
        sendLeaseExpiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
        failureReason: "",
        updatedAt: new Date().toISOString()
      });
      tasks[index] = next;
      await repositories.tasks.write(tasks);
      return next;
    });
  }

  async function appendRunLog(entry: unknown): Promise<RunLogEntry> {
    return queueMutation("run-logs", async () => {
      const parsed = runLogEntrySchema.parse(entry);
      const logs = await repositories.runLogs.read();
      logs.push(parsed);
      await repositories.runLogs.write(logs);
      return parsed;
    });
  }

  async function getRunLogs(): Promise<RunLogEntry[]> {
    return repositories.runLogs.read();
  }

  async function mutateTasksAtomically(
    taskIds: string[],
    to: GreetingTaskStatus,
    metadata: Partial<Omit<GreetingTask, "id" | "createdAt" | "updatedAt" | "status">> = {}
  ): Promise<GreetingTask[]> {
    return queueMutation("tasks", () => mutateTasksAtomicallyInternal(taskIds, to, metadata));
  }

  async function mutateTasksAtomicallyInternal(
    taskIds: string[],
    to: GreetingTaskStatus,
    metadata: Partial<Omit<GreetingTask, "id" | "createdAt" | "updatedAt" | "status">> = {}
  ): Promise<GreetingTask[]> {
    // mutateTasksAtomicallyInternal runs INSIDE an existing queueMutation("tasks") —
    // do not wrap in another queueMutation here.
    const tasks = await repositories.tasks.read();
    const uniqueTaskIds = Array.from(new Set(taskIds));
    const validated = uniqueTaskIds.map((taskId) => {
      const index = tasks.findIndex((task) => task.id === taskId);
      if (index < 0) {
        throw new DomainEntityNotFoundError("task", taskId);
      }

      const current = tasks[index];
      const allowed = taskTransitionMap[current.status];
      if (!allowed.includes(to)) {
        throw new DomainTransitionError(current.status, to);
      }

      const next = greetingTaskSchema.parse({
        ...current,
        ...metadata,
        status: to,
        updatedAt: new Date().toISOString()
      });

      return { index, current, next };
    });

    const changed = validated.filter(({ current, next }) => hasTaskChanged(current, next));
    if (changed.length === 0) {
      return validated.map(({ current }) => current);
    }

    const nextTasks = tasks.slice();
    for (const { index, next } of changed) {
      nextTasks[index] = next;
    }

    await repositories.tasks.write(nextTasks);
    return validated.map(({ current, next }) => (hasTaskChanged(current, next) ? next : current));
  }

  return {
    getConfig,
    saveConfig,
    getProfile,
    saveProfile,
    getTemplate,
    saveTemplate,
    getJobs,
    upsertJobs,
    getTasks,
    createOrUpdateTask,
    createTaskIfNoActiveJobTask,
    updateTaskDraft,
    approveTasks,
    rejectTasks,
    transitionTask,
    getApprovedTasks,
    claimApprovedTasksWithinQuota,
    getDailyUsage,
    getDailyUsageHistory,
    incrementConfirmedSend,
    confirmTaskSent,
    refreshTaskSendReservation,
    appendRunLog,
    getRunLogs,
    writeSentJob,
    getSentJobs,
    getPreferenceState,
    recordJobFeedback,
    removeJobs,
    undoPreferenceFeedback,
    savePreferenceRules,
    restorePreferenceRuleVersion,
    saveSuggestionBatch,
    updateSuggestionBatch
  };
}

function mergeCollectedJob(existing: JobCard, incoming: JobCard): JobCard {
  const keepExistingDetail = existing.jdSource === "detail" && incoming.jdSource !== "detail";
  return jobCardSchema.parse({
    ...existing,
    ...incoming,
    id: existing.id,
    salary: incoming.salary || existing.salary,
    jdText: keepExistingDetail ? existing.jdText : incoming.jdText || existing.jdText,
    jdSource: keepExistingDetail ? existing.jdSource : incoming.jdSource,
    experience: incoming.experience || existing.experience,
    education: incoming.education || existing.education,
    industry: incoming.industry || existing.industry,
    rawText: incoming.rawText || existing.rawText
  });
}

export function getDomainStore(
  baseDir = process.env.BOSS_AGENT_DATA_DIR ?? path.join(process.cwd(), ".boss-agent-data")
) {
  const resolvedBaseDir = resolveDomainStoreBaseDir(baseDir);
  const existing = domainStoreCache.get(resolvedBaseDir);
  if (existing) {
    return existing;
  }

  const created = createDomainStore(resolvedBaseDir);
  domainStoreCache.set(resolvedBaseDir, created);
  return created;
}

export function resetDomainStoreCache(
  baseDir?: string
): void {
  if (baseDir) {
    domainStoreCache.delete(resolveDomainStoreBaseDir(baseDir));
    return;
  }

  domainStoreCache.clear();
}

function createDefaultDailyUsage(date: string): DailyUsage {
  return dailyUsageSchema.parse({
    date,
    confirmedSends: 0,
    failures: 0,
    modelCalls: 0,
    estimatedCostCny: 0,
    pausedReason: "",
    updatedAt: new Date().toISOString()
  });
}

function mergeConfirmedTaskUsage(usage: DailyUsage, tasks: GreetingTask[]): DailyUsage {
  const confirmedFromTasks = tasks.filter(
    (task) =>
      (task.status === "sent" || task.status === "paused") &&
      Boolean(task.confirmationEvidence) &&
      (task.quotaReservationDate ??
        (task.sentAt ? getShanghaiDateKey(new Date(task.sentAt)) : "")) === usage.date
  ).length;
  return dailyUsageSchema.parse({
    ...usage,
    confirmedSends: Math.max(usage.confirmedSends, confirmedFromTasks)
  });
}

function getSendLeaseExpiry(task: GreetingTask): Date {
  if (task.sendLeaseExpiresAt) return new Date(task.sendLeaseExpiresAt);
  return new Date(new Date(task.updatedAt).getTime() + 2 * 60_000);
}

function hasTaskChanged(current: GreetingTask, next: GreetingTask): boolean {
  const { updatedAt: currentUpdatedAt, ...currentComparable } = current;
  const { updatedAt: nextUpdatedAt, ...nextComparable } = next;
  void currentUpdatedAt;
  void nextUpdatedAt;
  return JSON.stringify(currentComparable) !== JSON.stringify(nextComparable);
}
