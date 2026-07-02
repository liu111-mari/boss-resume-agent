import { describe, expect, it } from "vitest";

import {
  parseNullableNumberDraft,
  parseRequiredNumberDraft,
  reconcileSelectedTaskIds
} from "@/lib/workbench-helpers";
import type { GreetingTask } from "@boss-agent/shared";

function createTask(overrides: Partial<GreetingTask> = {}): GreetingTask {
  return {
    id: "task-1",
    jobId: "job-1",
    jobTitle: "数据分析师",
    company: "示例科技",
    detailUrl: "",
    messageDraft: "您好",
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
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    ...overrides
  };
}

describe("workbench helpers", () => {
  it("reconciles selected ids to current pending_review and paused tasks", () => {
    const tasks = [
      createTask({ id: "task-pending", status: "pending_review" }),
      createTask({ id: "task-paused", status: "paused" }),
      createTask({ id: "task-approved", status: "approved" }),
      createTask({ id: "task-sending", status: "sending" })
    ];

    expect(
      reconcileSelectedTaskIds(tasks, [
        "task-pending",
        "task-paused",
        "task-approved",
        "task-missing"
      ])
    ).toEqual(["task-pending", "task-paused"]);
  });

  it("parses nullable number drafts without producing NaN", () => {
    expect(parseNullableNumberDraft("")).toEqual({ ok: true, value: null });
    expect(parseNullableNumberDraft("12")).toEqual({ ok: true, value: 12 });
    expect(parseNullableNumberDraft("1e")).toEqual({ ok: false, message: "请输入有效数字" });
    expect(parseNullableNumberDraft("NaN")).toEqual({ ok: false, message: "请输入有效数字" });
  });

  it("parses required integer drafts and rejects empty or non-integer values", () => {
    expect(parseRequiredNumberDraft("")).toEqual({ ok: false, message: "该字段不能为空" });
    expect(parseRequiredNumberDraft("1e")).toEqual({ ok: false, message: "请输入有效数字" });
    expect(parseRequiredNumberDraft("1.5")).toEqual({ ok: false, message: "请输入整数" });
    expect(parseRequiredNumberDraft("12")).toEqual({ ok: true, value: 12 });
  });
});
