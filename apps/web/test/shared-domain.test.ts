import { describe, expect, it } from "vitest";

import {
  filterConfigSchema,
  greetingTaskSchema,
  greetingTemplateSchema,
  profileSchema,
  type GreetingTask
} from "@boss-agent/shared";

// @ts-expect-error legacy draft status must not be assignable to the schema-inferred type
const legacyDraftStatus: GreetingTask["status"] = "draft";
void legacyDraftStatus;

describe("shared greeting automation domain schemas", () => {
  it("applies the complete filter configuration defaults", () => {
    expect(filterConfigSchema.parse({})).toEqual({
      targetTitles: [],
      cities: [],
      salaryUnit: "day",
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
      salaryUnit: "month",
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
      salaryUnit: "month",
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
    expect(result.refinementFallback).toBe(false);
    expect(result.scoringProvider).toBe("");
    expect(result.scoringModel).toBe("");
    expect(result.refinementProvider).toBe("");
    expect(result.refinementModel).toBe("");
  });

  it("parses explicit scoring and refinement audit fields", () => {
    const result = greetingTaskSchema.parse({
      id: "task-audit",
      jobId: "job-audit",
      jobTitle: "数据分析师",
      company: "示例科技",
      messageDraft: "你好，我对这个岗位很感兴趣。",
      status: "pending_review",
      modelProvider: "local",
      modelName: "template",
      scoringProvider: "deepseek",
      scoringModel: "deepseek-chat",
      refinementProvider: "local",
      refinementModel: "template",
      refinementFallback: true,
      createdAt: "2026-06-18T08:00:00.000Z",
      updatedAt: "2026-06-18T08:05:00.000Z"
    });

    expect(result).toMatchObject({
      modelProvider: "local",
      modelName: "template",
      scoringProvider: "deepseek",
      scoringModel: "deepseek-chat",
      refinementProvider: "local",
      refinementModel: "template",
      refinementFallback: true
    });
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
