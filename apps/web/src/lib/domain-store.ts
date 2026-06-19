import path from "node:path";

import {
  filterConfigSchema,
  greetingTaskSchema,
  greetingTemplateSchema,
  inferDirection,
  jobCardSchema,
  profileSchema,
  type FilterConfig,
  type GreetingTask,
  type GreetingTaskStatus,
  type GreetingTemplate,
  type JobCard,
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
  body: "您好，我是{{school}}{{major}}专业学生，关注到{{jobTitle}}岗位，期待进一步沟通。",
  tone: "专业自然",
  minLength: 30,
  maxLength: 120,
  maxSkills: 2,
  maxProjects: 1,
  bannedPhrases: ["海投", "群发"],
  version: 1
});

const taskTransitionMap: Record<GreetingTaskStatus, readonly GreetingTaskStatus[]> = {
  collected: ["filtered", "rejected", "failed"],
  filtered: ["scored", "rejected", "failed"],
  scored: ["generated", "rejected", "failed"],
  generated: ["pending_review", "failed"],
  pending_review: ["approved", "rejected"],
  approved: ["sending", "rejected", "quota_blocked"],
  sending: ["sent", "failed", "paused", "quota_blocked"],
  paused: ["approved", "rejected"],
  quota_blocked: ["approved", "rejected"],
  sent: [],
  rejected: [],
  failed: []
};

export type RunLogEntry = z.infer<typeof runLogEntrySchema>;
export type DailyUsage = z.infer<typeof dailyUsageSchema>;

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
    dailyUsage: new JsonRepository(path.join(resolvedBaseDir, "daily-usage.json"), dailyUsageListSchema, [])
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
          jobs[existingIndex] = { ...jobs[existingIndex], ...job };
        } else {
          jobs.unshift(job);
        }
      }

      return repositories.jobs.write(jobs);
    });
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

  async function approveTasks(taskIds: string[]): Promise<GreetingTask[]> {
    return mutateTasksAtomically(taskIds, "approved");
  }

  async function rejectTasks(taskIds: string[], failureReason = ""): Promise<GreetingTask[]> {
    return mutateTasksAtomically(taskIds, "rejected", { failureReason });
  }

  async function getApprovedTasks(): Promise<GreetingTask[]> {
    const tasks = await repositories.tasks.read();
    return tasks.filter((task) => task.status === "approved");
  }

  async function getDailyUsage(date: string): Promise<DailyUsage> {
    const usage = await repositories.dailyUsage.read();
    return usage.find((item) => item.date === date) ?? createDefaultDailyUsage(date);
  }

  async function getDailyUsageHistory(): Promise<DailyUsage[]> {
    return repositories.dailyUsage.read();
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
    approveTasks,
    rejectTasks,
    transitionTask,
    getApprovedTasks,
    getDailyUsage,
    getDailyUsageHistory,
    incrementConfirmedSend,
    appendRunLog,
    getRunLogs
  };

  async function mutateTasksAtomically(
    taskIds: string[],
    to: GreetingTaskStatus,
    metadata: Partial<Omit<GreetingTask, "id" | "createdAt" | "updatedAt" | "status">> = {}
  ): Promise<GreetingTask[]> {
    return queueMutation("tasks", async () => {
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
    });
  }
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

function hasTaskChanged(current: GreetingTask, next: GreetingTask): boolean {
  const { updatedAt: currentUpdatedAt, ...currentComparable } = current;
  const { updatedAt: nextUpdatedAt, ...nextComparable } = next;
  void currentUpdatedAt;
  void nextUpdatedAt;
  return JSON.stringify(currentComparable) !== JSON.stringify(nextComparable);
}
