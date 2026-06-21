import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GreetingTask, JobCard, Profile } from "@boss-agent/shared";
import { createDomainStore, resetDomainStoreCache } from "@/lib/domain-store";
import type {
  GreetingModelProvider,
  RefineGreetingResult,
  ScoreJobResult
} from "@/lib/model-provider";

const BASE_URL = "http://localhost";
const FIXED_NOW = "2026-06-20T08:00:00.000Z";

function createJob(overrides: Partial<JobCard> = {}): JobCard {
  return {
    id: "job-1",
    title: "数据分析师",
    company: "示例科技",
    city: "上海",
    salary: "15-25K",
    hrName: "",
    hrActiveText: "",
    detailUrl: "https://example.com/jobs/1",
    sourcePage: "boss",
    jdText: "负责数据分析，熟悉 SQL、Python，善于沟通协作",
    experience: "1-3年",
    education: "本科",
    industry: "",
    rawText: "",
    direction: "数据分析",
    collectedAt: "2026-06-19T00:00:00.000Z",
    ...overrides
  };
}

function createProfile(): Profile {
  return {
    school: "复旦大学",
    major: "信息管理",
    graduation: "2026",
    direction: "数据分析",
    items: [
      {
        id: "intro-1",
        category: "intro",
        content: "我有数据分析相关实习经验。",
        tags: ["数据分析"],
        enabled: true
      },
      {
        id: "skill-sql",
        category: "skill",
        content: "熟悉 SQL 和数据分析。",
        tags: ["SQL", "数据分析"],
        enabled: true
      },
      {
        id: "skill-python",
        category: "skill",
        content: "熟悉 Python 数据清洗。",
        tags: ["Python", "数据分析"],
        enabled: true
      },
      {
        id: "skill-disabled",
        category: "skill",
        content: "熟悉 Tableau。",
        tags: ["BI"],
        enabled: false
      },
      {
        id: "project-sql",
        category: "project",
        content: "做过 SQL 用户分群项目。",
        tags: ["SQL"],
        enabled: true
      },
      {
        id: "project-disabled",
        category: "project",
        content: "做过被禁用项目。",
        tags: ["Python"],
        enabled: false
      }
    ]
  };
}

function createTask(overrides: Partial<GreetingTask> = {}): GreetingTask {
  return {
    id: "task-existing",
    jobId: "job-1",
    jobTitle: "数据分析师",
    company: "示例科技",
    detailUrl: "https://example.com/jobs/1",
    messageDraft: "已有草稿",
    status: "pending_review",
    score: undefined,
    matchReasons: [],
    matchedRequirements: [],
    missingRequirements: [],
    usedProfileItemIds: [],
    modelProvider: "local",
    modelName: "template",
    scoringProvider: "",
    scoringModel: "",
    refinementProvider: "",
    refinementModel: "",
    refinementFallback: false,
    templateVersion: 1,
    estimatedCostCny: 0,
    failureReason: "",
    createdAt: "2026-06-19T00:00:00.000Z",
    updatedAt: "2026-06-19T00:00:00.000Z",
    ...overrides
  };
}

function createScoreResult(overrides: Partial<ScoreJobResult> = {}): ScoreJobResult {
  return {
    score: 86,
    matchedRequirements: ["SQL", "Python"],
    missingRequirements: ["沟通"],
    reasons: ["技能匹配较强"],
    recommendedProfileFields: ["skill-sql", "project-sql"],
    provider: "score-provider",
    model: "score-model",
    estimatedCostCny: 0.12,
    ...overrides
  };
}

function createRefineResult(overrides: Partial<RefineGreetingResult> = {}): RefineGreetingResult {
  return {
    text: "您好，我是复旦大学信息管理专业学生，看到贵司数据分析师岗位后很感兴趣，熟悉 SQL 和 Python，也做过 SQL 用户分群项目，期待进一步沟通。",
    provider: "refine-provider",
    model: "refine-model",
    estimatedCostCny: 0.23,
    ...overrides
  };
}

function jsonRequest(pathname: string, body?: unknown): Request {
  return new Request(`${BASE_URL}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function createProvider(overrides: Partial<GreetingModelProvider> = {}): GreetingModelProvider {
  return {
    scoreJob: vi.fn(async () => createScoreResult()),
    refineGreeting: vi.fn(async () => createRefineResult()),
    ...overrides
  };
}

type PipelineStore = ReturnType<typeof createDomainStore>;

function createPipelineStoreStub(jobs: JobCard[]): PipelineStore {
  const tasks: GreetingTask[] = [];
  const logs: Array<Record<string, unknown>> = [];
  const config = {
    targetTitles: [],
    cities: [],
    salaryUnit: "day" as const,
    minSalary: null,
    maxSalary: null,
    employmentTypes: [],
    requiredKeywords: ["SQL", "Python"],
    excludedKeywords: [],
    blockedCompanies: [],
    blockedIndustries: [],
    allowedExperience: [],
    allowedEducation: [],
    scoreThreshold: 70,
    dailyLimit: 100
  };
  const profile = createProfile();
  const template = {
    body: "你好，我是{{school}}{{major}}学生，想应聘{{jobTitle}}，熟悉{{skills}}，做过{{projects}}。{{selfIntro}}",
    tone: "自然",
    minLength: 20,
    maxLength: 140,
    maxSkills: 2,
    maxProjects: 1,
    bannedPhrases: ["海投"],
    version: 3
  };

  return {
    getConfig: vi.fn(async () => config),
    saveConfig: vi.fn(async (input: unknown) => input as never),
    getProfile: vi.fn(async () => profile),
    saveProfile: vi.fn(async (input: unknown) => input as never),
    getTemplate: vi.fn(async () => template),
    saveTemplate: vi.fn(async (input: unknown) => input as never),
    getJobs: vi.fn(async () => jobs),
    upsertJobs: vi.fn(async () => jobs),
    getTasks: vi.fn(async () => [...tasks]),
    createOrUpdateTask: vi.fn(async (input: unknown) => {
      const task = structuredClone(input as GreetingTask);
      const index = tasks.findIndex((item) => item.id === task.id);
      if (index >= 0) {
        tasks[index] = task;
      } else {
        tasks.unshift(task);
      }
      return task;
    }),
    createTaskIfNoActiveJobTask: vi.fn(async (input: unknown) => {
      const task = structuredClone(input as GreetingTask);
      const hasActive = tasks.some(
        (item) =>
          item.jobId === task.jobId &&
          ["collected", "filtered", "scored", "generated", "pending_review", "approved", "sending", "paused", "quota_blocked"].includes(item.status)
      );
      if (hasActive) {
        return null;
      }
      tasks.unshift(task);
      return task;
    }),
    updateTaskDraft: vi.fn(async (taskId: string, messageDraft: string, expectedUpdatedAt: string) => {
      const index = tasks.findIndex((item) => item.id === taskId);
      if (index < 0) {
        throw new Error(`missing task: ${taskId}`);
      }

      const current = tasks[index];
      if (current.updatedAt !== expectedUpdatedAt) {
        throw new Error(`stale task: ${taskId}`);
      }

      const next = {
        ...current,
        messageDraft,
        updatedAt: FIXED_NOW
      };
      tasks[index] = next;
      return next;
    }),
    approveTasks: vi.fn(async () => []),
    rejectTasks: vi.fn(async () => []),
    transitionTask: vi.fn(async (taskId: string, status: GreetingTask["status"], metadata?: Partial<GreetingTask>) => {
      const index = tasks.findIndex((item) => item.id === taskId);
      if (index < 0) {
        throw new Error(`missing task: ${taskId}`);
      }
      const next = {
        ...tasks[index],
        ...metadata,
        status,
        updatedAt: FIXED_NOW
      };
      tasks[index] = next;
      return next;
    }),
    getApprovedTasks: vi.fn(async () => tasks.filter((task) => task.status === "approved")),
    claimApprovedTasksWithinQuota: vi.fn(async () => ({
      tasks: [],
      approvedCount: tasks.filter((task) => task.status === "approved").length,
      quota: {
        date: "2026-06-20",
        used: 0,
        limit: 100,
        reserved: 0,
        remaining: 100,
        blocked: false,
        usage: {
          date: "2026-06-20",
          confirmedSends: 0,
          failures: 0,
          modelCalls: 0,
          estimatedCostCny: 0,
          pausedReason: "",
          updatedAt: FIXED_NOW
        },
        config
      }
    })),
    getDailyUsage: vi.fn(async () => ({
      date: "2026-06-20",
      confirmedSends: 0,
      failures: 0,
      modelCalls: 0,
      estimatedCostCny: 0,
      pausedReason: "",
      updatedAt: FIXED_NOW
    })),
    getDailyUsageHistory: vi.fn(async () => []),
    incrementConfirmedSend: vi.fn(async () => ({
      date: "2026-06-20",
      confirmedSends: 1,
      failures: 0,
      modelCalls: 0,
      estimatedCostCny: 0,
      pausedReason: "",
      updatedAt: FIXED_NOW
    })),
    confirmTaskSent: vi.fn(async (taskId: string, confirmationEvidence: string) => {
      const index = tasks.findIndex((item) => item.id === taskId);
      if (index < 0) throw new Error(`missing task: ${taskId}`);
      const next = {
        ...tasks[index],
        status: "sent" as const,
        confirmationEvidence,
        sentAt: FIXED_NOW,
        updatedAt: FIXED_NOW
      };
      tasks[index] = next;
      return next;
    }),
    refreshTaskSendReservation: vi.fn(async (taskId: string) => {
      const task = tasks.find((item) => item.id === taskId);
      if (!task) throw new Error(`missing task: ${taskId}`);
      return task;
    }),
    appendRunLog: vi.fn(async (entry: unknown) => {
      logs.push(entry as Record<string, unknown>);
      return entry as never;
    }),
    getRunLogs: vi.fn(async () => logs as never)
  } as PipelineStore;
}

describe("greeting pipeline", () => {
  let tempDir = "";

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-greeting-pipeline-"));
    resetDomainStoreCache();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    resetDomainStoreCache();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  async function makeStore() {
    const store = createDomainStore(tempDir);
    await store.saveConfig({
      requiredKeywords: ["SQL", "Python"],
      scoreThreshold: 70,
      dailyLimit: 100
    });
    await store.saveProfile(createProfile());
    await store.saveTemplate({
      body: "你好，我是{{school}}{{major}}学生，想应聘{{jobTitle}}，熟悉{{skills}}，做过{{projects}}。{{selfIntro}}",
      tone: "自然",
      minLength: 20,
      maxLength: 140,
      maxSkills: 2,
      maxProjects: 1,
      bannedPhrases: ["海投"],
      version: 3
    });
    await store.upsertJobs([createJob()]);
    return store;
  }

  it("hard rejects without calling the model provider", async () => {
    const { createGreetingPipeline } = await import("@/lib/greeting-pipeline");
    const store = await makeStore();
    await store.saveConfig({
      requiredKeywords: ["SQL"],
      excludedKeywords: ["外包"],
      scoreThreshold: 70,
      dailyLimit: 100
    });
    await store.upsertJobs([
      createJob({
        id: "job-hard-reject",
        title: "外包数据分析师",
        detailUrl: "https://example.com/jobs/reject"
      })
    ]);
    const provider = createProvider();

    const result = await createGreetingPipeline({
      store,
      provider,
      now: () => FIXED_NOW
    }).run(["job-hard-reject"]);

    expect(result).toMatchObject({
      processed: 1,
      hardRejected: 1,
      scoreRejected: 0,
      pendingReview: 0,
      failed: 0
    });
    expect(provider.scoreJob).not.toHaveBeenCalled();
    expect(provider.refineGreeting).not.toHaveBeenCalled();

    await expect(store.getTasks()).resolves.toEqual([
      expect.objectContaining({
        jobId: "job-hard-reject",
        status: "rejected",
        failureReason: "命中排除关键词：外包"
      })
    ]);
  });

  it("records missing requested job ids as failed without calling the provider", async () => {
    const { createGreetingPipeline } = await import("@/lib/greeting-pipeline");
    const store = await makeStore();
    const provider = createProvider();

    const result = await createGreetingPipeline({
      store,
      provider,
      now: () => FIXED_NOW
    }).run(["job-missing"]);

    expect(result).toMatchObject({
      processed: 0,
      hardRejected: 0,
      scoreRejected: 0,
      pendingReview: 0,
      failed: 1
    });
    expect(provider.scoreJob).not.toHaveBeenCalled();
    expect(provider.refineGreeting).not.toHaveBeenCalled();

    const logs = await store.getRunLogs();
    expect(logs).toEqual([
      expect.objectContaining({
        level: "error",
        jobId: "job-missing",
        detail: "job_not_found"
      })
    ]);
  });

  it("rejects low-score jobs before pending review", async () => {
    const { createGreetingPipeline } = await import("@/lib/greeting-pipeline");
    const store = await makeStore();
    const provider = createProvider({
      scoreJob: vi.fn(async () =>
        createScoreResult({
          score: 61,
          reasons: ["相关度不足"]
        })
      )
    });

    const result = await createGreetingPipeline({
      store,
      provider,
      now: () => FIXED_NOW
    }).run();

    expect(result).toMatchObject({
      processed: 1,
      hardRejected: 0,
      scoreRejected: 1,
      pendingReview: 0,
      failed: 0
    });

    await expect(store.getTasks()).resolves.toEqual([
      expect.objectContaining({
        jobId: "job-1",
        status: "rejected",
        score: 61,
        failureReason: "评分低于阈值：61 < 70"
      })
    ]);
  });

  it("persists exact metadata for successful runs and only uses enabled profile items", async () => {
    const { createGreetingPipeline } = await import("@/lib/greeting-pipeline");
    const store = await makeStore();
    const provider = createProvider();

    const result = await createGreetingPipeline({
      store,
      provider,
      now: () => FIXED_NOW
    }).run();

    expect(result).toMatchObject({
      processed: 1,
      hardRejected: 0,
      scoreRejected: 0,
      pendingReview: 1,
      failed: 0,
      estimatedCostCny: 0.35
    });

    const [task] = await store.getTasks();
    expect(task).toMatchObject({
      jobId: "job-1",
      status: "pending_review",
      score: 86,
      matchedRequirements: ["SQL", "Python"],
      missingRequirements: ["沟通"],
      matchReasons: ["技能匹配较强"],
      usedProfileItemIds: ["intro-1", "skill-sql", "skill-python", "project-sql"],
      modelProvider: "refine-provider",
      modelName: "refine-model",
      scoringProvider: "score-provider",
      scoringModel: "score-model",
      refinementProvider: "refine-provider",
      refinementModel: "refine-model",
      refinementFallback: false,
      templateVersion: 3,
      estimatedCostCny: 0.35,
      messageDraft: createRefineResult().text
    });
    expect(task.usedProfileItemIds).not.toContain("skill-disabled");
    expect(task.usedProfileItemIds).not.toContain("project-disabled");
  });

  it("falls back to local rendered greeting when refinement fails and logs the fallback", async () => {
    const { createGreetingPipeline } = await import("@/lib/greeting-pipeline");
    const store = await makeStore();
    const provider = createProvider({
      refineGreeting: vi.fn(async () => {
        throw new Error("refine exploded");
      })
    });

    const result = await createGreetingPipeline({
      store,
      provider,
      now: () => FIXED_NOW
    }).run();

    expect(result.failed).toBe(0);
    expect(result.pendingReview).toBe(1);

    const [task] = await store.getTasks();
    expect(task.status).toBe("pending_review");
    expect(task.modelProvider).toBe("local");
    expect(task.modelName).toBe("template");
    expect(task.scoringProvider).toBe("score-provider");
    expect(task.scoringModel).toBe("score-model");
    expect(task.refinementProvider).toBe("local");
    expect(task.refinementModel).toBe("template");
    expect(task.refinementFallback).toBe(true);
    expect(task.messageDraft).toContain("你好，我是复旦大学信息管理学生");

    const logs = await store.getRunLogs();
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          jobId: "job-1",
          detail: "refinement_fallback"
        })
      ])
    );
  });

  it("skips jobs already represented by non-terminal tasks", async () => {
    const { createGreetingPipeline } = await import("@/lib/greeting-pipeline");
    const store = await makeStore();
    await store.createOrUpdateTask(createTask({ id: "task-open", status: "generated" }));
    const provider = createProvider();

    const result = await createGreetingPipeline({
      store,
      provider,
      now: () => FIXED_NOW
    }).run();

    expect(result.processed).toBe(0);
    expect(provider.scoreJob).not.toHaveBeenCalled();
    await expect(store.getTasks()).resolves.toHaveLength(1);
  });

  it("allows reruns when the existing task is terminal and creates a new task id", async () => {
    const { createGreetingPipeline } = await import("@/lib/greeting-pipeline");
    const store = await makeStore();
    await store.createOrUpdateTask(createTask({ id: "task-terminal", status: "rejected" }));
    vi.spyOn(crypto, "randomUUID").mockReturnValue("task-new-run");
    const provider = createProvider();

    const result = await createGreetingPipeline({
      store,
      provider,
      now: () => FIXED_NOW
    }).run();

    expect(result.processed).toBe(1);

    const tasks = await store.getTasks();
    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "task-terminal", status: "rejected" }),
        expect.objectContaining({ id: "task-new-run", status: "pending_review", jobId: "job-1" })
      ])
    );
  });

  it("marks the task failed when score generation fails", async () => {
    const { createGreetingPipeline } = await import("@/lib/greeting-pipeline");
    const store = await makeStore();
    const provider = createProvider({
      scoreJob: vi.fn(async () => {
        throw new Error("score exploded");
      })
    });

    const result = await createGreetingPipeline({
      store,
      provider,
      now: () => FIXED_NOW
    }).run();

    expect(result).toMatchObject({
      processed: 1,
      failed: 1,
      pendingReview: 0
    });

    await expect(store.getTasks()).resolves.toEqual([
      expect.objectContaining({
        jobId: "job-1",
        status: "failed",
        failureReason: "score exploded"
      })
    ]);
  });

  it("retains refine cost when refinement output fails validation and falls back locally", async () => {
    const { createGreetingPipeline } = await import("@/lib/greeting-pipeline");
    const store = await makeStore();
    const provider = createProvider({
      refineGreeting: vi.fn(async () =>
        createRefineResult({
          text: "海投".repeat(80),
          estimatedCostCny: 0.23
        })
      )
    });

    const result = await createGreetingPipeline({
      store,
      provider,
      now: () => FIXED_NOW
    }).run();

    expect(result).toMatchObject({
      failed: 0,
      pendingReview: 1,
      estimatedCostCny: 0.35
    });

    const [task] = await store.getTasks();
    expect(task).toMatchObject({
      status: "pending_review",
      estimatedCostCny: 0.35,
      modelProvider: "local",
      modelName: "template",
      scoringProvider: "score-provider",
      scoringModel: "score-model",
      refinementProvider: "local",
      refinementModel: "template",
      refinementFallback: true
    });
    expect(task.messageDraft).toContain("你好，我是复旦大学信息管理学生");
  });

  it("claims a real store job atomically so concurrent pipeline runs only process it once", async () => {
    const { createGreetingPipeline } = await import("@/lib/greeting-pipeline");
    const store = await makeStore();
    let scoreCalls = 0;
    const provider = createProvider({
      scoreJob: vi.fn(async () => {
        scoreCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return createScoreResult();
      })
    });

    const [first, second] = await Promise.all([
      createGreetingPipeline({
        store,
        provider,
        now: () => FIXED_NOW
      }).run(["job-1"]),
      createGreetingPipeline({
        store,
        provider,
        now: () => FIXED_NOW
      }).run(["job-1"])
    ]);

    expect(first.pendingReview + second.pendingReview).toBe(1);
    expect(scoreCalls).toBeLessThanOrEqual(1);

    const tasks = await store.getTasks();
    expect(tasks.filter((task) => task.jobId === "job-1" && task.status === "pending_review")).toHaveLength(1);
    expect(tasks.filter((task) => task.jobId === "job-1" && task.status !== "rejected" && task.status !== "failed" && task.status !== "sent")).toHaveLength(1);
  });

  it("isolates unexpected per-job transition failures and continues other jobs", async () => {
    const { createGreetingPipeline } = await import("@/lib/greeting-pipeline");
    const store = await makeStore();
    await store.upsertJobs([
      createJob({ id: "job-2", detailUrl: "https://example.com/jobs/2" })
    ]);

    const createdTaskIdsByJob = new Map<string, string>();
    let injectedFailure = false;
    const wrappedStore = {
      ...store,
      createTaskIfNoActiveJobTask: vi.fn(async (input: unknown) => {
        const task = input as GreetingTask;
        const created = await store.createTaskIfNoActiveJobTask(input);
        if (created) {
          createdTaskIdsByJob.set(task.jobId, created.id);
        }
        return created;
      }),
      transitionTask: vi.fn(async (taskId: string, status: GreetingTask["status"], metadata?: unknown) => {
        if (!injectedFailure && taskId === createdTaskIdsByJob.get("job-1") && status === "filtered") {
          injectedFailure = true;
          throw new Error("transition boom");
        }
        return store.transitionTask(taskId, status, metadata as never);
      })
    };
    const provider = createProvider();

    const result = await createGreetingPipeline({
      store: wrappedStore as typeof store,
      provider,
      now: () => FIXED_NOW
    }).run(["job-1", "job-2"]);

    expect(result).toMatchObject({
      failed: 1,
      pendingReview: 1
    });

    const tasks = await store.getTasks();
    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ jobId: "job-2", status: "pending_review" })
      ])
    );
    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ jobId: "job-1", status: expect.stringMatching(/collected|failed/) })
      ])
    );

    const logs = await store.getRunLogs();
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          jobId: "job-1"
        })
      ])
    );
  });

  it("redacts sensitive error details before writing logs", async () => {
    const { createGreetingPipeline } = await import("@/lib/greeting-pipeline");
    const store = await makeStore();
    const provider = createProvider({
      scoreJob: vi.fn(async () => {
        throw new Error("Bearer secret-token sk-live-secret api_key=hunter2");
      })
    });

    const result = await createGreetingPipeline({
      store,
      provider,
      now: () => FIXED_NOW
    }).run();

    expect(result.failed).toBe(1);

    const logs = await store.getRunLogs();
    const errorLog = logs.find((entry) => entry.level === "error");
    expect(errorLog?.detail).toBeDefined();
    expect(errorLog?.detail).not.toContain("secret-token");
    expect(errorLog?.detail).not.toContain("sk-live-secret");
    expect(errorLog?.detail).not.toContain("hunter2");
  });

  it("limits concurrent provider work to the configured maximum", async () => {
    const { createGreetingPipeline } = await import("@/lib/greeting-pipeline");
    const jobs = [
      createJob(),
      createJob({ id: "job-2", detailUrl: "https://example.com/jobs/2" }),
      createJob({ id: "job-3", detailUrl: "https://example.com/jobs/3" }),
      createJob({ id: "job-4", detailUrl: "https://example.com/jobs/4" }),
      createJob({ id: "job-5", detailUrl: "https://example.com/jobs/5" })
    ];
    const store = createPipelineStoreStub(jobs);

    let active = 0;
    let maxActive = 0;
    const provider = createProvider({
      scoreJob: vi.fn(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return createScoreResult();
      })
    });

    const result = await createGreetingPipeline({
      store,
      provider,
      now: () => FIXED_NOW,
      concurrency: 10
    }).run();

    expect(result.pendingReview).toBe(jobs.length);
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("persists the accepted path in collected then filtered order before model work", async () => {
    const { createGreetingPipeline } = await import("@/lib/greeting-pipeline");
    const store = await makeStore();
    const callOrder: string[] = [];
    const wrappedStore = {
      ...store,
      createTaskIfNoActiveJobTask: vi.fn(async (input: unknown) => {
        const task = input as GreetingTask;
        callOrder.push(`create:${task.status}:${task.jobId}`);
        return store.createTaskIfNoActiveJobTask(input);
      }),
      transitionTask: vi.fn(async (taskId: string, status: GreetingTask["status"], metadata?: unknown) => {
        callOrder.push(`transition:${status}:${taskId}`);
        return store.transitionTask(taskId, status, metadata as never);
      })
    };
    const provider = createProvider({
      scoreJob: vi.fn(async (input) => {
        callOrder.push(`score:${input.job.id}`);
        return createScoreResult();
      })
    });

    await createGreetingPipeline({
      store: wrappedStore as typeof store,
      provider,
      now: () => FIXED_NOW
    }).run(["job-1"]);

    expect(callOrder).toContain("create:collected:job-1");
    expect(callOrder).toContain("score:job-1");
    expect(callOrder.indexOf("create:collected:job-1")).toBeLessThan(
      callOrder.indexOf(`transition:filtered:${(await store.getTasks())[0].id}`)
    );
    expect(callOrder.indexOf(`transition:filtered:${(await store.getTasks())[0].id}`)).toBeLessThan(
      callOrder.indexOf("score:job-1")
    );
  });

  it("persists hard rejection as collected then rejected without model work", async () => {
    const { createGreetingPipeline } = await import("@/lib/greeting-pipeline");
    const store = await makeStore();
    await store.saveConfig({
      requiredKeywords: ["SQL"],
      excludedKeywords: ["外包"],
      scoreThreshold: 70,
      dailyLimit: 100
    });
    await store.upsertJobs([
      createJob({
        id: "job-hard-reject-order",
        title: "外包数据分析师",
        detailUrl: "https://example.com/jobs/reject-order"
      })
    ]);
    const callOrder: string[] = [];
    const wrappedStore = {
      ...store,
      createTaskIfNoActiveJobTask: vi.fn(async (input: unknown) => {
        const task = input as GreetingTask;
        callOrder.push(`create:${task.status}:${task.jobId}`);
        return store.createTaskIfNoActiveJobTask(input);
      }),
      transitionTask: vi.fn(async (taskId: string, status: GreetingTask["status"], metadata?: unknown) => {
        callOrder.push(`transition:${status}:${taskId}`);
        return store.transitionTask(taskId, status, metadata as never);
      })
    };
    const provider = createProvider();

    await createGreetingPipeline({
      store: wrappedStore as typeof store,
      provider,
      now: () => FIXED_NOW
    }).run(["job-hard-reject-order"]);

    const [task] = await store.getTasks();
    expect(callOrder).toEqual([
      `create:collected:job-hard-reject-order`,
      `transition:rejected:${task.id}`
    ]);
    expect(provider.scoreJob).not.toHaveBeenCalled();
  });
});

describe("pipeline run route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("rejects unknown body fields with a 400", async () => {
    vi.doMock("@/lib/greeting-pipeline", () => ({
      runGreetingPipeline: vi.fn()
    }));
    const route = await import("@/app/api/pipeline/run/route");

    const response = await route.POST(
      jsonRequest("/api/pipeline/run", {
        jobIds: ["job-1"],
        unexpected: true
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_request"
    });
  });

  it("returns pipeline counts for valid requests", async () => {
    const runGreetingPipeline = vi.fn(async () => ({
      processed: 2,
      hardRejected: 1,
      scoreRejected: 0,
      pendingReview: 1,
      failed: 0,
      estimatedCostCny: 0.35
    }));
    vi.doMock("@/lib/greeting-pipeline", () => ({
      runGreetingPipeline
    }));
    const route = await import("@/app/api/pipeline/run/route");

    const response = await route.POST(
      jsonRequest("/api/pipeline/run", {
        jobIds: ["job-1", "job-2"]
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      counts: {
        processed: 2,
        hardRejected: 1,
        scoreRejected: 0,
        pendingReview: 1,
        failed: 0,
        estimatedCostCny: 0.35
      }
    });
    expect(runGreetingPipeline).toHaveBeenCalledWith(["job-1", "job-2"]);
  });
});
