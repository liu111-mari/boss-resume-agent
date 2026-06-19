import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  filterConfigSchema,
  greetingTaskSchema,
  greetingTemplateSchema,
  profileSchema,
  type GreetingTask
} from "@boss-agent/shared";
import {
  approveTasks,
  createGreetingTasks,
  store,
  updateTaskStatus,
  upsertJobs
} from "@/lib/store";

// @ts-expect-error legacy draft status must not be assignable to the schema-inferred type
const legacyDraftStatus: GreetingTask["status"] = "draft";
void legacyDraftStatus;

describe("shared greeting automation domain schemas", () => {
  it("applies the complete filter configuration defaults", () => {
    expect(filterConfigSchema.parse({})).toEqual({
      targetTitles: [],
      cities: [],
      minSalary: null,
      maxSalary: null,
      employmentTypes: [],
      requiredKeywords: [],
      excludedKeywords: [],
      blockedCompanies: [],
      blockedIndustries: [],
      allowedExperience: [],
      allowedEducation: [],
      scoreThreshold: 70,
      dailyLimit: 100
    });
  });

  it("parses the complete filter configuration", () => {
    const result = filterConfigSchema.parse({
      targetTitles: ["数据分析师"],
      cities: ["上海"],
      minSalary: 12000,
      maxSalary: 25000,
      employmentTypes: ["campus", "social"],
      requiredKeywords: ["SQL"],
      excludedKeywords: ["外包"],
      blockedCompanies: ["示例公司"],
      blockedIndustries: ["保险"],
      allowedExperience: ["应届生"],
      allowedEducation: ["本科"],
      scoreThreshold: 75,
      dailyLimit: 80
    });

    expect(result).toMatchObject({
      targetTitles: ["数据分析师"],
      cities: ["上海"],
      minSalary: 12000,
      maxSalary: 25000,
      employmentTypes: ["campus", "social"],
      requiredKeywords: ["SQL"],
      excludedKeywords: ["外包"],
      blockedCompanies: ["示例公司"],
      blockedIndustries: ["保险"],
      allowedExperience: ["应届生"],
      allowedEducation: ["本科"],
      scoreThreshold: 75,
      dailyLimit: 80
    });
  });

  it("rejects a maximum salary below the minimum salary", () => {
    const result = filterConfigSchema.safeParse({
      minSalary: 20000,
      maxSalary: 10000
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["maxSalary"]);
    }
  });

  it("parses a pending review greeting task with update metadata", () => {
    const result = greetingTaskSchema.parse({
      id: "task-1",
      jobId: "job-1",
      jobTitle: "AI 产品经理",
      company: "示例科技",
      detailUrl: "https://example.com/jobs/1",
      messageDraft: "你好，我对这个岗位很感兴趣。",
      status: "pending_review",
      createdAt: "2026-06-18T08:00:00.000Z",
      updatedAt: "2026-06-18T08:05:00.000Z"
    });

    expect(result.status).toBe("pending_review");
    expect(result.updatedAt).toBe("2026-06-18T08:05:00.000Z");
  });

  it("rejects the legacy draft greeting task status", () => {
    const result = greetingTaskSchema.safeParse({
      id: "task-draft",
      jobId: "job-draft",
      jobTitle: "数据分析师",
      company: "示例科技",
      messageDraft: "你好，我对这个岗位很感兴趣。",
      status: "draft",
      createdAt: "2026-06-18T08:00:00.000Z",
      updatedAt: "2026-06-18T08:00:00.000Z"
    });

    expect(result.success).toBe(false);
  });

  it("applies empty defaults to a profile", () => {
    const result = profileSchema.parse({});

    expect(result).toEqual({
      school: "",
      major: "",
      graduation: "",
      direction: "",
      items: []
    });
  });

  it("parses a greeting template", () => {
    const result = greetingTemplateSchema.parse({
      body: "你好，我具备 {{skills}} 经验，希望进一步沟通。",
      tone: "专业自然",
      minLength: 30,
      maxLength: 120,
      maxSkills: 2,
      maxProjects: 1,
      bannedPhrases: ["海投"],
      version: 1
    });

    expect(result).toMatchObject({
      body: "你好，我具备 {{skills}} 经验，希望进一步沟通。",
      tone: "专业自然",
      minLength: 30,
      maxLength: 120,
      maxSkills: 2,
      maxProjects: 1,
      bannedPhrases: ["海投"],
      version: 1
    });
  });

  it("rejects a template maximum length below its minimum length", () => {
    const result = greetingTemplateSchema.safeParse({
      body: "你好",
      minLength: 100,
      maxLength: 50
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["maxLength"]);
    }
  });
});

describe("greeting task store state", () => {
  beforeEach(() => {
    store.jobs.length = 0;
    store.conversations.length = 0;
    store.tasks.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates pending review tasks with updatedAt", () => {
    upsertJobs([
      {
        id: "job-1",
        title: "AI 产品经理",
        company: "示例科技",
        city: "上海",
        collectedAt: "2026-06-18T08:00:00.000Z"
      }
    ]);

    const [task] = createGreetingTasks(["job-1"]);

    expect(task.status).toBe("pending_review");
    expect(task.updatedAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(task.updatedAt))).toBe(false);
  });

  it("approves only pending review tasks", () => {
    upsertJobs([
      {
        id: "job-2",
        title: "数据分析师",
        company: "示例数据",
        city: "杭州",
        collectedAt: "2026-06-18T08:00:00.000Z"
      },
      {
        id: "job-3",
        title: "产品经理",
        company: "示例产品",
        city: "上海",
        collectedAt: "2026-06-18T08:00:00.000Z"
      }
    ]);
    const [pendingTask, failedTask] = createGreetingTasks(["job-2", "job-3"]);
    failedTask.status = "failed";
    pendingTask.updatedAt = "2026-06-18T08:00:00.000Z";
    failedTask.updatedAt = "2026-06-18T08:00:00.000Z";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T09:30:00.000Z"));

    approveTasks([pendingTask.id, failedTask.id]);

    expect(pendingTask.status).toBe("approved");
    expect(pendingTask.updatedAt).toBe("2026-06-19T09:30:00.000Z");
    expect(failedTask.status).toBe("failed");
    expect(failedTask.updatedAt).toBe("2026-06-18T08:00:00.000Z");
  });

  it("updates updatedAt when updateTaskStatus changes status", () => {
    upsertJobs([
      {
        id: "job-4",
        title: "实施顾问",
        company: "示例咨询",
        city: "深圳",
        collectedAt: "2026-06-18T08:00:00.000Z"
      }
    ]);
    const [task] = createGreetingTasks(["job-4"]);
    task.updatedAt = "2026-06-18T08:00:00.000Z";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T10:45:00.000Z"));

    updateTaskStatus(task.id, "sending");

    expect(task.status).toBe("sending");
    expect(task.updatedAt).toBe("2026-06-19T10:45:00.000Z");
  });

  it("updates updatedAt when failureReason changes without a status change", () => {
    upsertJobs([
      {
        id: "job-5",
        title: "产品运营",
        company: "示例运营",
        city: "北京",
        collectedAt: "2026-06-18T08:00:00.000Z"
      }
    ]);
    const [task] = createGreetingTasks(["job-5"]);
    task.status = "failed";
    task.failureReason = "network error";
    task.updatedAt = "2026-06-18T08:00:00.000Z";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T11:30:00.000Z"));

    updateTaskStatus(task.id, "failed", "quota exceeded");

    expect(task.failureReason).toBe("quota exceeded");
    expect(task.updatedAt).toBe("2026-06-19T11:30:00.000Z");
  });

  it("preserves updatedAt when status and failureReason do not change", () => {
    upsertJobs([
      {
        id: "job-6",
        title: "AI Agent 工程师",
        company: "示例智能",
        city: "广州",
        collectedAt: "2026-06-18T08:00:00.000Z"
      }
    ]);
    const [task] = createGreetingTasks(["job-6"]);
    task.status = "failed";
    task.failureReason = "network error";
    task.updatedAt = "2026-06-18T08:00:00.000Z";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T12:00:00.000Z"));

    updateTaskStatus(task.id, "failed", "network error");

    expect(task.updatedAt).toBe("2026-06-18T08:00:00.000Z");
  });
});
