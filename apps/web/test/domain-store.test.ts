import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { GreetingTask, JobCard } from "@boss-agent/shared";
import {
  createDomainStore,
  DomainConflictError,
  DomainEntityNotFoundError,
  DomainTransitionError
} from "@/lib/domain-store";

function createJob(overrides: Partial<JobCard> = {}): JobCard {
  return {
    id: "job-1",
    title: "AI 产品经理",
    company: "示例科技",
    city: "上海",
    salary: "",
    hrName: "",
    hrActiveText: "",
    detailUrl: "",
    sourcePage: "boss",
    jdText: "负责 AI 产品规划和需求分析",
    experience: "",
    education: "",
    industry: "",
    rawText: "",
    direction: "其他",
    collectedAt: "2026-06-19T00:00:00.000Z",
    ...overrides
  };
}

function createTask(overrides: Partial<GreetingTask> = {}): GreetingTask {
  return {
    id: "task-1",
    jobId: "job-1",
    jobTitle: "AI 产品经理",
    company: "示例科技",
    detailUrl: "https://example.com/jobs/1",
    messageDraft: "您好，我想进一步沟通该岗位。",
    status: "collected",
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

describe("domain store", () => {
  let tempDir = "";

  afterEach(async () => {
    vi.useRealTimers();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  async function makeStore() {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-domain-store-"));
    return createDomainStore(tempDir);
  }

  it("uses the editable six-part greeting structure for a fresh store", async () => {
    const store = await makeStore();

    const template = await store.getTemplate();

    expect(template.version).toBe(2);
    expect(template.body).toContain("{{jobTitle}}");
    expect(template.body).toContain("{{selfIntro}}");
    expect(template.body).toContain("{{projects}}");
    expect(template.body).toContain("匹配优势");
    expect(template.body).toContain("{{skills}}");
    expect(template.body).toContain("详细情况您可以看下我的简历，期待您的回复");
  });

  it("persists data across store reconstruction", async () => {
    const store = await makeStore();

    await store.saveConfig({ targetTitles: ["数据分析师"], dailyLimit: 80 });
    await store.saveProfile({
      school: "复旦大学",
      major: "信息管理",
      graduation: "2027",
      direction: "数据分析",
      items: []
    });
    await store.saveTemplate({
      body: "你好，我是{{school}}{{major}}学生，想应聘{{jobTitle}}。",
      tone: "自然",
      minLength: 20,
      maxLength: 80,
      maxSkills: 2,
      maxProjects: 1,
      bannedPhrases: [],
      version: 1
    });

    const rebuilt = createDomainStore(tempDir);

    await expect(rebuilt.getConfig()).resolves.toMatchObject({
      targetTitles: ["数据分析师"],
      dailyLimit: 80
    });
    await expect(rebuilt.getProfile()).resolves.toMatchObject({
      school: "复旦大学",
      major: "信息管理"
    });
    await expect(rebuilt.getTemplate()).resolves.toMatchObject({
      body: "你好，我是{{school}}{{major}}学生，想应聘{{jobTitle}}。"
    });
  });

  it("deduplicates jobs by id or non-empty detailUrl and infers direction", async () => {
    const store = await makeStore();

    await store.upsertJobs([
      createJob({
        id: "job-detail-1",
        title: "数据分析师",
        detailUrl: "https://example.com/jobs/1",
        jdText: "熟悉 SQL 和数据分析"
      }),
      createJob({
        id: "job-detail-2",
        title: "高级数据分析师",
        detailUrl: "https://example.com/jobs/1",
        jdText: "熟悉 SQL 和经营分析"
      }),
      createJob({
        id: "job-stable",
        title: "AI 产品经理",
        detailUrl: "https://example.com/jobs/2",
        jdText: "负责 AI 产品规划"
      }),
      createJob({
        id: "job-stable",
        title: "AI Agent 工程师",
        detailUrl: "https://example.com/jobs/3",
        jdText: "负责 Agent 工作流和 RAG"
      })
    ]);

    await expect(store.getJobs()).resolves.toEqual([
      expect.objectContaining({
        id: "job-stable",
        title: "AI Agent 工程师",
        direction: "AI Agent"
      }),
      expect.objectContaining({
        id: "job-detail-2",
        title: "高级数据分析师",
        detailUrl: "https://example.com/jobs/1",
        direction: "数据分析"
      })
    ]);
  });

  it("supports valid task transitions and rejects invalid ones with DomainTransitionError", async () => {
    const store = await makeStore();
    await store.createOrUpdateTask(createTask());

    await store.transitionTask("task-1", "filtered");
    await store.transitionTask("task-1", "scored");
    await store.transitionTask("task-1", "generated");
    await store.transitionTask("task-1", "pending_review");
    await store.transitionTask("task-1", "approved");
    await store.transitionTask("task-1", "sending");
    await store.refreshTaskSendReservation("task-1", "2026-06-19");
    await store.confirmTaskSent("task-1", "message:task-1", "2026-06-19");

    await expect(store.getTasks()).resolves.toEqual([
      expect.objectContaining({ id: "task-1", status: "sent" })
    ]);

    await expect(store.transitionTask("task-1", "approved")).rejects.toEqual(
      expect.objectContaining({
        from: "sent",
        to: "approved"
      })
    );
    await expect(store.transitionTask("task-1", "approved")).rejects.toBeInstanceOf(DomainTransitionError);
  });

  it("atomically claims only one active task per job across concurrent callers", async () => {
    const first = await makeStore();
    const second = createDomainStore(tempDir);

    const [claimedA, claimedB] = await Promise.all([
      first.createTaskIfNoActiveJobTask(createTask({ id: "task-claim-a" })),
      second.createTaskIfNoActiveJobTask(createTask({ id: "task-claim-b" }))
    ]);

    expect([claimedA, claimedB].filter((value) => value !== null)).toHaveLength(1);
    await expect(first.getTasks()).resolves.toEqual([
      expect.objectContaining({
        jobId: "job-1",
        status: "collected"
      })
    ]);
  });

  it("allows claiming a new task when the existing task for the job is terminal", async () => {
    const store = await makeStore();
    await store.createOrUpdateTask(createTask({ id: "task-terminal", status: "rejected" }));

    const claimed = await store.createTaskIfNoActiveJobTask(
      createTask({
        id: "task-rerun",
        status: "collected"
      })
    );

    expect(claimed).toMatchObject({
      id: "task-rerun",
      jobId: "job-1",
      status: "collected"
    });
    await expect(store.getTasks()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "task-terminal", status: "rejected" }),
        expect.objectContaining({ id: "task-rerun", status: "collected" })
      ])
    );
  });

  it("allows quota_blocked transitions from approved and sending before returning to approved", async () => {
    const store = await makeStore();
    await store.createOrUpdateTask(createTask({ id: "task-approved", status: "pending_review" }));
    await store.approveTasks(["task-approved"]);
    await store.transitionTask("task-approved", "quota_blocked");
    await store.transitionTask("task-approved", "approved");
    await store.transitionTask("task-approved", "sending");
    await store.transitionTask("task-approved", "quota_blocked");

    await expect(store.getTasks()).resolves.toEqual([
      expect.objectContaining({ id: "task-approved", status: "quota_blocked" })
    ]);
  });

  it("throws DomainEntityNotFoundError when transitioning a missing task", async () => {
    const store = await makeStore();

    await expect(store.transitionTask("missing-task", "approved")).rejects.toEqual(
      expect.objectContaining({ entityType: "task", entityId: "missing-task" })
    );
    await expect(store.transitionTask("missing-task", "approved")).rejects.toBeInstanceOf(DomainEntityNotFoundError);
  });

  it("approveTasks and rejectTasks reuse transitions and getApprovedTasks filters correctly", async () => {
    const store = await makeStore();
    await store.createOrUpdateTask(createTask({ id: "task-approved", status: "pending_review" }));
    await store.createOrUpdateTask(createTask({ id: "task-rejected", status: "pending_review" }));

    await store.approveTasks(["task-approved"]);
    await store.rejectTasks(["task-rejected"], "人工驳回");

    await expect(store.getApprovedTasks()).resolves.toEqual([
      expect.objectContaining({ id: "task-approved", status: "approved" })
    ]);
    await expect(store.getTasks()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "task-rejected", status: "rejected", failureReason: "人工驳回" })
      ])
    );
  });

  it("approveTasks is atomic and rolls back the whole batch when any transition is invalid", async () => {
    const store = await makeStore();
    await store.createOrUpdateTask(createTask({ id: "task-ok", status: "pending_review" }));
    await store.createOrUpdateTask(createTask({ id: "task-bad", status: "collected" }));

    await expect(store.approveTasks(["task-ok", "task-bad"])).rejects.toBeInstanceOf(DomainTransitionError);

    await expect(store.getTasks()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "task-ok", status: "pending_review" }),
        expect.objectContaining({ id: "task-bad", status: "collected" })
      ])
    );
  });

  it("rejectTasks is atomic and rolls back the whole batch when any task is missing", async () => {
    const store = await makeStore();
    await store.createOrUpdateTask(createTask({ id: "task-ok", status: "pending_review" }));

    await expect(store.rejectTasks(["task-ok", "missing-task"], "人工驳回")).rejects.toBeInstanceOf(
      DomainEntityNotFoundError
    );

    await expect(store.getTasks()).resolves.toEqual([
      expect.objectContaining({ id: "task-ok", status: "pending_review", failureReason: "" })
    ]);
  });

  it("updates updatedAt only when task state or metadata actually changes", async () => {
    const store = await makeStore();
    await store.createOrUpdateTask(createTask());

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T09:00:00.000Z"));
    const first = await store.createOrUpdateTask(createTask());
    expect(first.updatedAt).toBe("2026-06-19T00:00:00.000Z");

    vi.setSystemTime(new Date("2026-06-19T10:00:00.000Z"));
    const second = await store.createOrUpdateTask(
      createTask({
        messageDraft: "您好，我很想进一步沟通该岗位。"
      })
    );
    expect(second.updatedAt).toBe("2026-06-19T10:00:00.000Z");
  });

  it("updates only the draft for a pending_review task when expectedUpdatedAt matches", async () => {
    const store = await makeStore();
    await store.createOrUpdateTask(createTask({ status: "pending_review" }));

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T11:00:00.000Z"));

    const updated = await store.updateTaskDraft(
      "task-1",
      "新的待审话术",
      "2026-06-19T00:00:00.000Z"
    );

    expect(updated).toMatchObject({
      id: "task-1",
      status: "pending_review",
      messageDraft: "新的待审话术",
      updatedAt: "2026-06-19T11:00:00.000Z"
    });
    expect(updated.modelProvider).toBe("local");
  });

  it("rejects draft updates when the task has already transitioned away from pending_review", async () => {
    const store = await makeStore();
    await store.createOrUpdateTask(createTask({ status: "pending_review" }));
    await store.transitionTask("task-1", "approved");

    await expect(
      store.updateTaskDraft("task-1", "旧草稿覆盖", "2026-06-19T00:00:00.000Z")
    ).rejects.toBeInstanceOf(DomainTransitionError);

    await expect(store.getTasks()).resolves.toEqual([
      expect.objectContaining({
        id: "task-1",
        status: "approved",
        messageDraft: "您好，我想进一步沟通该岗位。"
      })
    ]);
  });

  it("rejects stale draft updates with DomainConflictError and leaves task state untouched", async () => {
    const store = await makeStore();
    await store.createOrUpdateTask(createTask({ status: "pending_review" }));

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T12:00:00.000Z"));
    const first = await store.updateTaskDraft(
      "task-1",
      "第一版草稿",
      "2026-06-19T00:00:00.000Z"
    );

    await expect(
      store.updateTaskDraft("task-1", "过期草稿", "2026-06-19T00:00:00.000Z")
    ).rejects.toBeInstanceOf(DomainConflictError);

    await expect(store.getTasks()).resolves.toEqual([
      expect.objectContaining({
        id: "task-1",
        status: "pending_review",
        messageDraft: "第一版草稿",
        updatedAt: first.updatedAt
      })
    ]);
  });

  it("increments daily usage concurrently without losing updates", async () => {
    const store = await makeStore();

    await Promise.all([
      store.incrementConfirmedSend("2026-06-19"),
      store.incrementConfirmedSend("2026-06-19"),
      store.incrementConfirmedSend("2026-06-19"),
      store.incrementConfirmedSend("2026-06-19")
    ]);

    await expect(store.getDailyUsage("2026-06-19")).resolves.toMatchObject({
      date: "2026-06-19",
      confirmedSends: 4
    });
  });

  it("shares one mutation lock across store instances for the same baseDir", async () => {
    const first = await makeStore();
    const second = createDomainStore(tempDir);

    await Promise.all([
      first.incrementConfirmedSend("2026-06-19"),
      second.incrementConfirmedSend("2026-06-19"),
      first.incrementConfirmedSend("2026-06-19"),
      second.incrementConfirmedSend("2026-06-19")
    ]);

    await expect(first.getDailyUsage("2026-06-19")).resolves.toMatchObject({
      date: "2026-06-19",
      confirmedSends: 4
    });
    await expect(second.getDailyUsage("2026-06-19")).resolves.toMatchObject({
      date: "2026-06-19",
      confirmedSends: 4
    });
  });

  it("waits for an external process holding the baseDir proper-lockfile lock before mutating usage", async () => {
    const store = await makeStore();
    const lockPath = `${tempDir}.lock`;
    const workerPath = path.join(process.cwd(), "apps/web/test/helpers/fs-lock-worker.mjs");
    const worker = spawn(process.execPath, [workerPath, lockPath, "250"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });

    const workerReady = new Promise<void>((resolve, reject) => {
      worker.stdout.setEncoding("utf8");
      worker.stdout.on("data", (chunk) => {
        if (chunk.includes("locked")) resolve();
      });
      worker.once("error", reject);
      worker.once("exit", (code) => {
        if (code !== 0) reject(new Error(`lock worker exited with code ${code}`));
      });
    });

    try {
      await workerReady;

      const startedAt = Date.now();
      await store.incrementConfirmedSend("2026-06-19");
      const elapsedMs = Date.now() - startedAt;

      expect(elapsedMs).toBeGreaterThanOrEqual(150);
      await expect(store.getDailyUsage("2026-06-19")).resolves.toMatchObject({
        date: "2026-06-19",
        confirmedSends: 1
      });
    } finally {
      worker.kill();
    }
  });

  it("persists run logs across store reconstruction", async () => {
    const store = await makeStore();

    await store.appendRunLog({
      id: "log-1",
      level: "info",
      message: "开始处理任务",
      createdAt: "2026-06-19T08:00:00.000Z"
    });
    await store.appendRunLog({
      id: "log-2",
      level: "error",
      message: "发送失败",
      createdAt: "2026-06-19T08:05:00.000Z",
      taskId: "task-1"
    });

    const rebuilt = createDomainStore(tempDir);

    await expect(rebuilt.getRunLogs()).resolves.toEqual([
      expect.objectContaining({ id: "log-1", message: "开始处理任务" }),
      expect.objectContaining({ id: "log-2", taskId: "task-1", level: "error" })
    ]);
  });
});
