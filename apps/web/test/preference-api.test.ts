import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JobCard } from "@boss-agent/shared";

const BASE_URL = "http://localhost";

function request(pathname: string, body: unknown): Request {
  return new Request(`${BASE_URL}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function createJob(overrides: Partial<JobCard> = {}): JobCard {
  return {
    id: "job-1",
    title: "门店销售",
    company: "示例公司",
    city: "北京",
    salary: "",
    hrName: "",
    hrActiveText: "",
    detailUrl: "",
    sourcePage: "boss",
    jdText: "电话邀约客户并完成销售指标",
    experience: "",
    education: "",
    industry: "生活服务",
    rawText: "",
    direction: "其他",
    collectedAt: "2026-07-03T00:00:00.000Z",
    ...overrides
  };
}

describe("preference API", () => {
  let tempDir = "";
  let previousDataDir: string | undefined;
  let previousProvider: string | undefined;
  let previousKey: string | undefined;

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    previousDataDir = process.env.BOSS_AGENT_DATA_DIR;
    previousProvider = process.env.GREETING_MODEL_PROVIDER;
    previousKey = process.env.GREETING_MODEL_API_KEY;
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-preference-api-"));
    process.env.BOSS_AGENT_DATA_DIR = tempDir;
    process.env.GREETING_MODEL_PROVIDER = "deepseek";
    process.env.GREETING_MODEL_API_KEY = "test-key";
    const storeModule = await import("@/lib/domain-store");
    storeModule.resetDomainStoreCache();
  });

  afterEach(async () => {
    const storeModule = await import("@/lib/domain-store");
    storeModule.resetDomainStoreCache();
    restoreEnv("BOSS_AGENT_DATA_DIR", previousDataDir);
    restoreEnv("GREETING_MODEL_PROVIDER", previousProvider);
    restoreEnv("GREETING_MODEL_API_KEY", previousKey);
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("records negative feedback, removes the job, and exposes preference state", async () => {
    const { getDomainStore } = await import("@/lib/domain-store");
    await getDomainStore().upsertJobs([createJob()]);
    const feedbackRoute = await import("@/app/api/preferences/feedback/route");
    const preferencesRoute = await import("@/app/api/preferences/route");

    const response = await feedbackRoute.POST(request("/api/preferences/feedback", {
      jobIds: ["job-1"],
      action: "negative_remove",
      focusFields: ["title", "industry", "jdResponsibilities"],
      note: "不喜欢纯销售"
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      removedJobIds: ["job-1"],
      feedback: [expect.objectContaining({ label: "negative" })]
    });
    const stateResponse = await preferencesRoute.GET();
    await expect(stateResponse.json()).resolves.toMatchObject({ newFeedbackCount: 1 });
  });

  it("supports neutral removal and feedback undo", async () => {
    const { getDomainStore } = await import("@/lib/domain-store");
    const store = getDomainStore();
    await store.upsertJobs([createJob(), createJob({ id: "job-2", title: "数据分析" })]);
    const feedbackRoute = await import("@/app/api/preferences/feedback/route");
    const undoRoute = await import("@/app/api/preferences/feedback/undo/route");

    const negative = await feedbackRoute.POST(request("/api/preferences/feedback", {
      jobIds: ["job-1"], action: "negative_remove", focusFields: ["title"], note: ""
    }));
    const negativeBody = await negative.json();
    const neutral = await feedbackRoute.POST(request("/api/preferences/feedback", {
      jobIds: ["job-2"], action: "remove", focusFields: [], note: ""
    }));

    await expect(neutral.json()).resolves.toMatchObject({ feedback: [], removedJobIds: ["job-2"] });
    const undone = await undoRoute.POST(request("/api/preferences/feedback/undo", {
      feedbackId: negativeBody.feedback[0].id
    }));
    await expect(undone.json()).resolves.toMatchObject({ restoredJob: { id: "job-1" } });
  });

  it("generates a draft, previews an edited candidate, and applies only confirmed rules", async () => {
    const { getDomainStore } = await import("@/lib/domain-store");
    const store = getDomainStore();
    await store.upsertJobs([createJob({ title: "招商主管" })]);
    const initialRules = (await store.getPreferenceState()).rules;
    await store.savePreferenceRules(initialRules.map((rule) => ({ ...rule, active: false })));
    await store.recordJobFeedback({
      jobIds: ["job-1"], label: "negative", remove: false, focusFields: ["title"], note: "纯销售"
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ candidates: [{
        tempId: "candidate-1",
        action: "exclude",
        field: "title",
        mode: "hard",
        values: ["招商主管"],
        statement: "",
        weight: 100,
        evidenceFeedbackIds: [(await store.getPreferenceState()).feedback[0].id],
        rationale: "负样本",
        confidence: 0.9
      }] }) } }]
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const generateRoute = await import("@/app/api/preferences/suggestions/generate/route");
    const previewRoute = await import("@/app/api/preferences/preview/route");
    const applyRoute = await import("@/app/api/preferences/suggestions/apply/route");

    const generated = await generateRoute.POST(request("/api/preferences/suggestions/generate", {
      correction: "只排除纯销售", previousBatchId: null
    }));
    const generatedBody = await generated.json();
    expect(generatedBody.batch.status).toBe("draft");

    const candidate = { ...generatedBody.batch.candidates[0], values: ["招商主管", "电话销售"] };
    const preview = await previewRoute.POST(request("/api/preferences/preview", { candidate }));
    await expect(preview.json()).resolves.toMatchObject({ willBeExcluded: [expect.objectContaining({ id: "job-1" })] });

    const applied = await applyRoute.POST(request("/api/preferences/suggestions/apply", {
      batchId: generatedBody.batch.id,
      candidates: [candidate]
    }));
    await expect(applied.json()).resolves.toMatchObject({
      rules: expect.arrayContaining([expect.objectContaining({ values: ["招商主管", "电话销售"], provenance: "ai_accepted" })])
    });
  });

  it("saves manually edited active rules", async () => {
    const preferencesRoute = await import("@/app/api/preferences/route");
    const rulesRoute = await import("@/app/api/preferences/rules/route");
    const state = await (await preferencesRoute.GET()).json();
    const edited = state.rules.map((rule: Record<string, unknown>) => ({ ...rule, active: false }));

    const response = await rulesRoute.PUT(request("/api/preferences/rules", { rules: edited }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ rules: expect.arrayContaining([expect.objectContaining({ active: false })]) });
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
