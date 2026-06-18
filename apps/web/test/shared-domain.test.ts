import { describe, expect, it } from "vitest";

import {
  filterConfigSchema,
  greetingTaskSchema,
  greetingTemplateSchema,
  profileSchema
} from "@boss-agent/shared";

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
