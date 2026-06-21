import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { GreetingTask } from "@boss-agent/shared";
import {
  createDomainStore,
  getShanghaiDateKey,
  resetDomainStoreCache
} from "@/lib/domain-store";

function createTask(
  id: string,
  status: GreetingTask["status"] = "sending",
  overrides: Partial<GreetingTask> = {}
): GreetingTask {
  return {
    id,
    jobId: `job-${id}`,
    jobTitle: "AI 产品经理",
    company: "示例科技",
    detailUrl: `https://example.com/${id}`,
    messageDraft: "您好，我想进一步沟通该岗位。",
    status,
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
    confirmationEvidence: "",
    sentAt: "",
    quotaReservationDate: status === "sending" ? "2026-06-21" : undefined,
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    ...overrides
  };
}

describe("confirmed-send quota", () => {
  let tempDir = "";

  afterEach(async () => {
    vi.useRealTimers();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  async function makeStore() {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-quota-"));
    return createDomainStore(tempDir);
  }

  it("uses the Asia/Shanghai calendar date", () => {
    expect(getShanghaiDateKey(new Date("2026-06-20T16:30:00.000Z"))).toBe("2026-06-21");
  });

  it("increments usage only for sending to sent with non-empty evidence", async () => {
    const store = await makeStore();
    await store.saveConfig({ dailyLimit: 2 });
    await store.createOrUpdateTask(createTask("confirmed"));
    await store.createOrUpdateTask(createTask("failed"));
    await store.createOrUpdateTask(createTask("paused"));

    await expect(store.confirmTaskSent("confirmed", "message:42", "2026-06-21")).resolves.toMatchObject({
      status: "sent",
      confirmationEvidence: "message:42"
    });
    await store.transitionTask("failed", "failed", { failureReason: "network" });
    await store.transitionTask("paused", "paused", { failureReason: "risk_blocker" });

    await expect(store.getDailyUsage("2026-06-21")).resolves.toMatchObject({ confirmedSends: 1 });
    await expect(store.confirmTaskSent("failed", "message:43", "2026-06-21")).rejects.toThrow();
    await expect(store.confirmTaskSent("paused", "message:44", "2026-06-21")).rejects.toThrow();
    await expect(store.confirmTaskSent("confirmed", "", "2026-06-21")).rejects.toThrow();
  });

  it("records every confirmed delivery truthfully even when legacy state already exceeds the limit", async () => {
    const first = await makeStore();
    const second = createDomainStore(tempDir);
    await first.saveConfig({ dailyLimit: 1 });
    await first.createOrUpdateTask(createTask("one"));
    await first.createOrUpdateTask(createTask("two"));

    const results = await Promise.allSettled([
      first.confirmTaskSent("one", "message:one", "2026-06-21"),
      second.confirmTaskSent("two", "message:two", "2026-06-21")
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    await expect(first.getDailyUsage("2026-06-21")).resolves.toMatchObject({ confirmedSends: 2 });
    expect((await first.getTasks()).filter((task) => task.status === "sent")).toHaveLength(2);
  });

  it("returns no approved tasks when today's confirmed quota is exhausted", async () => {
    const previousDataDir = process.env.BOSS_AGENT_DATA_DIR;
    const store = await makeStore();
    process.env.BOSS_AGENT_DATA_DIR = tempDir;
    resetDomainStoreCache();

    try {
      await store.saveConfig({ dailyLimit: 1 });
      await store.createOrUpdateTask(createTask("sent"));
      await store.createOrUpdateTask(createTask("approved", "approved"));
      await store.confirmTaskSent("sent", "message:sent", getShanghaiDateKey());

      const { GET } = await import("@/app/api/tasks/approved/route");
      const response = await GET();
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        tasks: [],
        approvedCount: 1,
        quota: {
          used: 1,
          limit: 1,
          blocked: true,
          remaining: 0
        }
      });
    } finally {
      resetDomainStoreCache();
      if (previousDataDir === undefined) delete process.env.BOSS_AGENT_DATA_DIR;
      else process.env.BOSS_AGENT_DATA_DIR = previousDataDir;
    }
  });

  it("returns at most the remaining confirmed-send capacity", async () => {
    const previousDataDir = process.env.BOSS_AGENT_DATA_DIR;
    const store = await makeStore();
    process.env.BOSS_AGENT_DATA_DIR = tempDir;
    resetDomainStoreCache();

    try {
      await store.saveConfig({ dailyLimit: 2 });
      await store.createOrUpdateTask(createTask("already-sent"));
      await store.createOrUpdateTask(createTask("approved-one", "approved"));
      await store.createOrUpdateTask(createTask("approved-two", "approved"));
      await store.confirmTaskSent("already-sent", "message:already-sent", getShanghaiDateKey());

      const { GET } = await import("@/app/api/tasks/approved/route");
      const response = await GET();
      const payload = await response.json();
      expect(payload.quota).toMatchObject({ used: 1, limit: 2, remaining: 1, blocked: false });
      expect(payload.approvedCount).toBe(2);
      expect(payload.tasks).toHaveLength(1);
    } finally {
      resetDomainStoreCache();
      if (previousDataDir === undefined) delete process.env.BOSS_AGENT_DATA_DIR;
      else process.env.BOSS_AGENT_DATA_DIR = previousDataDir;
    }
  });

  it("atomically claims sending capacity so concurrent runners cannot over-send", async () => {
    const store = await makeStore();
    const second = createDomainStore(tempDir);
    await store.saveConfig({ dailyLimit: 1 });
    await store.createOrUpdateTask(createTask("claim-one", "approved"));
    await store.createOrUpdateTask(createTask("claim-two", "approved"));

    const [firstClaim, secondClaim] = await Promise.all([
      store.claimApprovedTasksWithinQuota("2026-06-21"),
      second.claimApprovedTasksWithinQuota("2026-06-21")
    ]);

    expect([...firstClaim.tasks, ...secondClaim.tasks]).toHaveLength(1);
    expect([...firstClaim.tasks, ...secondClaim.tasks][0]).toMatchObject({ status: "sending" });
    expect((await store.getTasks()).filter((task) => task.status === "sending")).toHaveLength(1);
    expect((await store.getTasks()).filter((task) => task.status === "approved")).toHaveLength(1);
  });

  it("refreshes the reservation before send so cross-midnight tasks cannot over-send", async () => {
    const first = await makeStore();
    const second = createDomainStore(tempDir);
    await first.saveConfig({ dailyLimit: 1 });
    await first.createOrUpdateTask(
      createTask("midnight-one", "sending", { quotaReservationDate: "2026-06-20" })
    );
    await first.createOrUpdateTask(
      createTask("midnight-two", "sending", { quotaReservationDate: "2026-06-20" })
    );

    const results = await Promise.allSettled([
      first.refreshTaskSendReservation("midnight-one", "2026-06-21"),
      second.refreshTaskSendReservation("midnight-two", "2026-06-21")
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await first.getTasks()).filter((task) => task.status === "sending")).toHaveLength(1);
    expect((await first.getTasks()).filter((task) => task.status === "quota_blocked")).toHaveLength(1);
  });

  it("pauses an expired sending lease instead of automatically resending it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-21T04:00:00.000Z"));
    const store = await makeStore();
    await store.saveConfig({ dailyLimit: 1 });
    await store.createOrUpdateTask(
      createTask("expired", "sending", {
        quotaReservationDate: "2026-06-21",
        sendLeaseExpiresAt: "2026-06-21T03:59:00.000Z"
      })
    );

    const result = await store.claimApprovedTasksWithinQuota("2026-06-21");
    expect(result.tasks).toHaveLength(0);
    await expect(store.getTasks()).resolves.toEqual([
      expect.objectContaining({
        id: "expired",
        status: "paused",
        failureReason: "send_lease_expired_manual_review"
      })
    ]);
  });

  it("counts a paused task with confirmation evidence so it cannot be resent for free", async () => {
    const store = await makeStore();
    await store.createOrUpdateTask(createTask("paused-confirmed", "sending"));
    await store.transitionTask("paused-confirmed", "paused", {
      confirmationEvidence: "message:paused-confirmed"
    });

    await expect(store.getDailyUsage("2026-06-21")).resolves.toMatchObject({
      confirmedSends: 1
    });
    await expect(
      store.confirmTaskSent("paused-confirmed", "message:paused-confirmed", "2026-06-21")
    ).resolves.toMatchObject({
      status: "sent",
      confirmationEvidence: "message:paused-confirmed"
    });
  });

  it("records confirmed delivery truthfully even if the configured limit was lowered after send", async () => {
    const store = await makeStore();
    await store.saveConfig({ dailyLimit: 2 });
    await store.createOrUpdateTask(createTask("confirmed-after-lower", "sending"));
    await store.saveConfig({ dailyLimit: 1 });
    await store.incrementConfirmedSend("2026-06-21");

    await expect(
      store.confirmTaskSent("confirmed-after-lower", "message:confirmed-after-lower", "2026-06-21")
    ).resolves.toMatchObject({
      status: "sent",
      confirmationEvidence: "message:confirmed-after-lower"
    });
  });

  it("rejects browser-form claims while accepting extension JSON claims", async () => {
    const previousDataDir = process.env.BOSS_AGENT_DATA_DIR;
    const store = await makeStore();
    process.env.BOSS_AGENT_DATA_DIR = tempDir;
    resetDomainStoreCache();
    try {
      await store.createOrUpdateTask(createTask("claim-api", "approved"));
      const { POST } = await import("@/app/api/tasks/approved/route");
      const rejected = await POST(
        new Request("http://localhost/api/tasks/approved", {
          method: "POST",
          headers: {
            origin: "https://evil.example",
            "content-type": "application/x-www-form-urlencoded"
          },
          body: "claim=true"
        })
      );
      expect(rejected.status).toBe(403);

      process.env.BOSS_AGENT_EXTENSION_ORIGIN = "chrome-extension://test-extension";
      const accepted = await POST(
        new Request("http://localhost/api/tasks/approved", {
          method: "POST",
          headers: {
            origin: "chrome-extension://test-extension",
            "content-type": "application/json"
          },
          body: "{}"
        })
      );
      expect(accepted.status).toBe(200);
      await expect(accepted.json()).resolves.toMatchObject({
        tasks: [expect.objectContaining({ id: "claim-api", status: "sending" })]
      });
    } finally {
      delete process.env.BOSS_AGENT_EXTENSION_ORIGIN;
      resetDomainStoreCache();
      if (previousDataDir === undefined) delete process.env.BOSS_AGENT_DATA_DIR;
      else process.env.BOSS_AGENT_DATA_DIR = previousDataDir;
    }
  });

  it("status API rejects sent without evidence and persists confirmed delivery with evidence", async () => {
    const previousDataDir = process.env.BOSS_AGENT_DATA_DIR;
    const store = await makeStore();
    process.env.BOSS_AGENT_DATA_DIR = tempDir;
    resetDomainStoreCache();

    try {
      await store.saveConfig({ dailyLimit: 2 });
      await store.createOrUpdateTask(createTask("api-confirm"));
      const { POST } = await import("@/app/api/tasks/status/route");

      const missingEvidence = await POST(
        new Request("http://local/api/tasks/status", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ taskId: "api-confirm", status: "sent" })
        })
      );
      expect(missingEvidence.status).toBe(400);

      const confirmed = await POST(
        new Request("http://local/api/tasks/status", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ taskId: "api-confirm", status: "sending" })
        })
      );
      expect(confirmed.status).toBe(200);

      const sent = await POST(
        new Request("http://local/api/tasks/status", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            taskId: "api-confirm",
            status: "sent",
            confirmationEvidence: "message:api-confirm"
          })
        })
      );
      expect(sent.status).toBe(200);
      await expect(sent.json()).resolves.toMatchObject({
        task: {
          status: "sent",
          confirmationEvidence: "message:api-confirm",
          sentAt: expect.any(String)
        }
      });
      await expect(store.getDailyUsage(getShanghaiDateKey())).resolves.toMatchObject({
        confirmedSends: 1
      });
    } finally {
      resetDomainStoreCache();
      if (previousDataDir === undefined) delete process.env.BOSS_AGENT_DATA_DIR;
      else process.env.BOSS_AGENT_DATA_DIR = previousDataDir;
    }
  });
});
