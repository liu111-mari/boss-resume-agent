import { beforeEach, describe, expect, it } from "vitest";

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
  upsertJobs
} from "@/lib/store";

// @ts-expect-error legacy draft status must not be assignable to the schema-inferred type
const legacyDraftStatus: GreetingTask["status"] = "draft";
void legacyDraftStatus;

describe("shared greeting automation domain schemas", () => {
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
});

describe("greeting task store state", () => {
  beforeEach(() => {
    store.jobs.length = 0;
    store.conversations.length = 0;
    store.tasks.length = 0;
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

    approveTasks([pendingTask.id, failedTask.id]);

    expect(pendingTask.status).toBe("approved");
    expect(failedTask.status).toBe("failed");
  });
});
