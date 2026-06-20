import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GreetingTask, JobCard } from "@boss-agent/shared";

const BASE_URL = "http://localhost";

function createJob(overrides: Partial<JobCard> = {}): JobCard {
  return {
    id: "job-1",
    title: "AI 产品经理",
    company: "示例科技",
    city: "上海",
    salary: "",
    hrName: "",
    hrActiveText: "",
    detailUrl: "https://example.com/jobs/1",
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

function jsonRequest(pathname: string, method: string, body?: unknown): Request {
  return new Request(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      "content-type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function importDomainStoreModule() {
  return import("@/lib/domain-store");
}

async function makeStore() {
  const module = await importDomainStoreModule();
  return module.createDomainStore(process.env.BOSS_AGENT_DATA_DIR);
}

async function resetDomainStore() {
  const module = await importDomainStoreModule();
  module.resetDomainStoreCache?.();
}

describe("persistent greeting automation API contracts", () => {
  let tempDir = "";
  let previousDataDir: string | undefined;

  beforeEach(async () => {
    vi.useRealTimers();
    previousDataDir = process.env.BOSS_AGENT_DATA_DIR;
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-api-contracts-"));
    process.env.BOSS_AGENT_DATA_DIR = tempDir;
    await resetDomainStore();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await resetDomainStore();
    if (previousDataDir === undefined) {
      delete process.env.BOSS_AGENT_DATA_DIR;
    } else {
      process.env.BOSS_AGENT_DATA_DIR = previousDataDir;
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("persists config/profile/template across cache reset and rejects invalid config", async () => {
    const configRoute = await import("@/app/api/config/route");
    const profileRoute = await import("@/app/api/profile/route");
    const templateRoute = await import("@/app/api/greeting-template/route");

    const configResponse = await configRoute.PUT(
      jsonRequest("/api/config", "PUT", {
        targetTitles: ["数据分析师"],
        dailyLimit: 80
      })
    );
    expect(configResponse.status).toBe(200);
    await expect(configResponse.json()).resolves.toMatchObject({
      config: expect.objectContaining({
        targetTitles: ["数据分析师"],
        dailyLimit: 80
      })
    });

    const profileResponse = await profileRoute.PUT(
      jsonRequest("/api/profile", "PUT", {
        school: "复旦大学",
        major: "信息管理",
        graduation: "2027",
        direction: "数据分析",
        items: []
      })
    );
    expect(profileResponse.status).toBe(200);

    const templateResponse = await templateRoute.PUT(
      jsonRequest("/api/greeting-template", "PUT", {
        body: "你好，我是{{school}}{{major}}学生，想应聘{{jobTitle}}。",
        tone: "自然",
        minLength: 20,
        maxLength: 80,
        maxSkills: 2,
        maxProjects: 1,
        bannedPhrases: [],
        version: 1
      })
    );
    expect(templateResponse.status).toBe(200);

    await resetDomainStore();

    await expect(configRoute.GET().then((response) => response.json())).resolves.toMatchObject({
      config: expect.objectContaining({
        targetTitles: ["数据分析师"],
        dailyLimit: 80
      })
    });
    await expect(profileRoute.GET().then((response) => response.json())).resolves.toMatchObject({
      profile: expect.objectContaining({
        school: "复旦大学",
        major: "信息管理"
      })
    });
    await expect(templateRoute.GET().then((response) => response.json())).resolves.toMatchObject({
      template: expect.objectContaining({
        body: "你好，我是{{school}}{{major}}学生，想应聘{{jobTitle}}。"
      })
    });

    const invalidResponse = await configRoute.PUT(
      jsonRequest("/api/config", "PUT", {
        dailyLimit: 151
      })
    );
    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toMatchObject({
      error: "invalid_request",
      issues: [
        expect.objectContaining({
          path: ["dailyLimit"]
        })
      ]
    });
  });

  it.each([
    ["missing jobs", {}],
    ["unknown fields", { foo: 1 }],
    ["empty jobs", { jobs: [] }]
  ])("rejects extension ingest with %s", async (_case, body) => {
    const ingestRoute = await import("@/app/api/extension/ingest/route");
    const response = await ingestRoute.POST(jsonRequest("/api/extension/ingest", "POST", body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_request",
      issues: expect.any(Array)
    });
  });

  it("upserts jobs via jobs and ingest routes and rejects conversations ingest", async () => {
    const jobsRoute = await import("@/app/api/jobs/route");
    const ingestRoute = await import("@/app/api/extension/ingest/route");

    const firstResponse = await jobsRoute.POST(
      jsonRequest(
        "/api/jobs",
        "POST",
        createJob({ id: "job-single", title: "数据分析师", detailUrl: "https://example.com/jobs/single" })
      )
    );
    expect(firstResponse.status).toBe(200);

    const ingestResponse = await ingestRoute.POST(
      jsonRequest("/api/extension/ingest", "POST", {
        jobs: [
          createJob({ id: "job-array-1", title: "AI Agent 工程师", jdText: "负责 Agent 工作流和 RAG" }),
          createJob({
            id: "job-array-2",
            title: "高级数据分析师",
            detailUrl: "https://example.com/jobs/shared",
            jdText: "熟悉 SQL 和经营分析"
          }),
          createJob({
            id: "job-array-3",
            title: "数据分析师",
            detailUrl: "https://example.com/jobs/shared",
            jdText: "熟悉 SQL 和数据分析"
          })
        ]
      })
    );
    expect(ingestResponse.status).toBe(200);
    await expect(ingestResponse.json()).resolves.toMatchObject({
      ok: true,
      acceptedCount: 3,
      jobs: expect.arrayContaining([
        expect.objectContaining({ id: "job-array-1", direction: "AI Agent" }),
        expect.objectContaining({ id: "job-array-3", direction: "数据分析" })
      ])
    });

    await resetDomainStore();
    const listResponse = await jobsRoute.GET();
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      jobs: expect.arrayContaining([
        expect.objectContaining({ id: "job-single", title: "数据分析师" }),
        expect.objectContaining({ id: "job-array-3", detailUrl: "https://example.com/jobs/shared" })
      ])
    });

    const rejectedResponse = await ingestRoute.POST(
      jsonRequest("/api/extension/ingest", "POST", {
        conversations: [{ id: "conv-1" }]
      })
    );
    expect(rejectedResponse.status).toBe(400);
    await expect(rejectedResponse.json()).resolves.toMatchObject({
      error: "conversations_not_supported"
    });
  });

  it("creates tasks from explicit task payloads, approves them, and reports quota basics", async () => {
    const tasksRoute = await import("@/app/api/tasks/route");
    const approveRoute = await import("@/app/api/tasks/approve/route");
    const approvedRoute = await import("@/app/api/tasks/approved/route");

    const createResponse = await tasksRoute.POST(
      jsonRequest("/api/tasks", "POST", {
        task: createTask()
      })
    );
    expect(createResponse.status).toBe(200);
    await expect(createResponse.json()).resolves.toMatchObject({
      task: expect.objectContaining({ id: "task-1", status: "pending_review" })
    });

    const approveResponse = await approveRoute.POST(
      jsonRequest("/api/tasks/approve", "POST", {
        taskIds: ["task-1"]
      })
    );
    expect(approveResponse.status).toBe(200);
    await expect(approveResponse.json()).resolves.toMatchObject({
      tasks: [expect.objectContaining({ id: "task-1", status: "approved" })]
    });

    const approvedResponse = await approvedRoute.GET();
    expect(approvedResponse.status).toBe(200);
    await expect(approvedResponse.json()).resolves.toMatchObject({
      tasks: [expect.objectContaining({ id: "task-1", status: "approved" })],
      quota: expect.objectContaining({
        usage: expect.objectContaining({ confirmedSends: 0 }),
        config: expect.objectContaining({ dailyLimit: 100 })
      })
    });

    const listResponse = await tasksRoute.GET();
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      tasks: [expect.objectContaining({ id: "task-1", status: "approved" })]
    });
  });

  it("maps missing tasks to 404 and illegal transitions to 409", async () => {
    const statusRoute = await import("@/app/api/tasks/status/route");
    const store = await makeStore();
    await store.createOrUpdateTask(createTask({ id: "task-collected", status: "collected" }));

    const missingResponse = await statusRoute.POST(
      jsonRequest("/api/tasks/status", "POST", {
        taskId: "missing-task",
        status: "approved"
      })
    );
    expect(missingResponse.status).toBe(404);
    await expect(missingResponse.json()).resolves.toMatchObject({
      error: "not_found"
    });

    const illegalResponse = await statusRoute.POST(
      jsonRequest("/api/tasks/status", "POST", {
        taskId: "task-collected",
        status: "approved",
        failureReason: "should fail"
      })
    );
    expect(illegalResponse.status).toBe(409);
    await expect(illegalResponse.json()).resolves.toMatchObject({
      error: "illegal_transition"
    });
  });

  it("patches pending_review drafts atomically and returns 409 for stale or transitioned tasks", async () => {
    const tasksRoute = await import("@/app/api/tasks/route");
    const draftRoute = await import("@/app/api/tasks/draft/route");
    const store = await makeStore();

    const createResponse = await tasksRoute.POST(
      jsonRequest("/api/tasks", "POST", {
        task: createTask({
          id: "task-draft",
          status: "pending_review",
          updatedAt: "2026-06-19T00:00:00.000Z"
        })
      })
    );
    expect(createResponse.status).toBe(200);

    const staleCreateResponse = await tasksRoute.POST(
      jsonRequest("/api/tasks", "POST", {
        task: createTask({
          id: "task-draft-stale",
          status: "pending_review",
          updatedAt: "2026-06-19T00:00:00.000Z"
        })
      })
    );
    expect(staleCreateResponse.status).toBe(200);

    const successResponse = await draftRoute.POST(
      jsonRequest("/api/tasks/draft", "POST", {
        taskId: "task-draft",
        messageDraft: "新的待审批话术",
        expectedUpdatedAt: "2026-06-19T00:00:00.000Z"
      })
    );
    expect(successResponse.status).toBe(200);
    const successPayload = await successResponse.json();
    expect(successPayload).toMatchObject({
      task: expect.objectContaining({
        id: "task-draft",
        status: "pending_review",
        messageDraft: "新的待审批话术"
      })
    });

    await store.transitionTask("task-draft", "approved");

    const transitionedResponse = await draftRoute.POST(
      jsonRequest("/api/tasks/draft", "POST", {
        taskId: "task-draft",
        messageDraft: "过期覆盖",
        expectedUpdatedAt: successPayload.task.updatedAt
      })
    );
    expect(transitionedResponse.status).toBe(409);
    await expect(transitionedResponse.json()).resolves.toMatchObject({
      error: "illegal_transition"
    });

    const staleResponse = await draftRoute.POST(
      jsonRequest("/api/tasks/draft", "POST", {
        taskId: "task-draft-stale",
        messageDraft: "更旧的话术",
        expectedUpdatedAt: "2026-06-18T00:00:00.000Z"
      })
    );
    expect(staleResponse.status).toBe(409);
    await expect(staleResponse.json()).resolves.toMatchObject({
      error: "conflict"
    });
  });

  it("returns run summary for today's local date with status counts and recent logs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T12:00:00.000Z"));

    const runSummaryRoute = await import("@/app/api/run-summary/route");
    const store = await makeStore();
    await store.saveConfig({ dailyLimit: 3 });
    await store.createOrUpdateTask(createTask({ id: "task-approved", status: "approved" }));
    await store.createOrUpdateTask(createTask({ id: "task-failed", status: "failed", failureReason: "network" }));
    await store.incrementConfirmedSend("2026-06-19");
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
      taskId: "task-failed"
    });

    const response = await runSummaryRoute.GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      date: "2026-06-19",
      config: expect.objectContaining({ dailyLimit: 3 }),
      usage: expect.objectContaining({ confirmedSends: 1 }),
      taskStatusCounts: expect.objectContaining({
        approved: 1,
        failed: 1
      }),
      recentLogs: [
        expect.objectContaining({ id: "log-2" }),
        expect.objectContaining({ id: "log-1" })
      ]
    });
  });

  it("redacts diagnostic secrets recursively and exports only safe persisted data", async () => {
    const diagnosticsModule = await import("@/lib/diagnostics");
    const exportRoute = await import("@/app/api/diagnostics/export/route");
    const store = await makeStore();

    const redacted = diagnosticsModule.redactDiagnosticsData({
      apiKey: "super-secret",
      nested: {
        Authorization: "Bearer abc",
        keep: "visible",
        items: [{ sessionToken: "nested-secret" }]
      },
      array: [{ password: "pw" }, "safe"]
    });
    const redactedSerialized = JSON.stringify(redacted);
    expect(redactedSerialized).not.toContain("super-secret");
    expect(redactedSerialized).not.toContain("nested-secret");
    expect(redactedSerialized).not.toContain("Bearer abc");
    expect(redacted).toMatchObject({
      nested: {
        keep: "visible"
      }
    });

    await store.saveConfig({ targetTitles: ["数据分析师"], dailyLimit: 2 });
    await store.upsertJobs([
      createJob({
        id: "job-secret",
        rawText: "SUPER-RAW-TEXT-SHOULD-NOT-LEAK"
      })
    ]);
    await store.createOrUpdateTask(createTask({ id: "task-export" }));
    await store.appendRunLog({
      id: "log-export",
      level: "info",
      message: "exported",
      createdAt: "2026-06-19T09:00:00.000Z"
    });
    await store.incrementConfirmedSend("2026-06-19");

    const response = await exportRoute.GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/attachment; filename=/);

    const payload = await response.json();
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("SUPER-RAW-TEXT-SHOULD-NOT-LEAK");
    expect(payload).toMatchObject({
      config: expect.objectContaining({
        targetTitles: ["数据分析师"],
        dailyLimit: 2
      }),
      tasks: [expect.objectContaining({ id: "task-export" })],
      logs: [expect.objectContaining({ id: "log-export" })],
      dailyUsage: [expect.objectContaining({ date: "2026-06-19", confirmedSends: 1 })]
    });
  });

  it("rejects selected pending-review tasks through the dedicated reject route", async () => {
    const tasksRoute = await import("@/app/api/tasks/route");
    const rejectRoute = await import("@/app/api/tasks/reject/route");

    const createResponse = await tasksRoute.POST(
      jsonRequest("/api/tasks", "POST", {
        task: createTask({ id: "task-reject-me", status: "pending_review" })
      })
    );
    expect(createResponse.status).toBe(200);

    const response = await rejectRoute.POST(
      jsonRequest("/api/tasks/reject", "POST", {
        taskIds: ["task-reject-me"],
        reason: "人工拒绝"
      })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      tasks: [
        expect.objectContaining({
          id: "task-reject-me",
          status: "rejected",
          failureReason: "人工拒绝"
        })
      ]
    });
  });
});
