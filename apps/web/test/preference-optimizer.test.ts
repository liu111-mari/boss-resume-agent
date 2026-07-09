import { describe, expect, it } from "vitest";

import {
  createDefaultPreferenceRules,
  preferenceFeedbackSchema,
  type JobCard,
  type Profile
} from "@boss-agent/shared";
import {
  buildPreferencePrompt,
  createConfiguredPreferenceOptimizer,
  createDeepSeekPreferenceOptimizer
} from "@/lib/preference-optimizer";

const job: JobCard = {
  id: "job-1",
  title: "门店销售",
  company: "示例公司",
  city: "北京",
  salary: "",
  hrName: "",
  hrActiveText: "",
  detailUrl: "",
  sourcePage: "boss",
  jdText: "负责电话邀约客户到店并完成销售指标",
  experience: "",
  education: "",
  industry: "生活服务",
  rawText: "",
  direction: "其他",
  collectedAt: "2026-07-03T00:00:00.000Z"
};

const feedback = preferenceFeedbackSchema.parse({
  id: "feedback-1",
  jobId: job.id,
  jobSnapshot: job,
  label: "negative",
  focusFields: ["title", "industry", "jdResponsibilities"],
  note: "不喜欢纯销售岗位",
  source: "negative_remove",
  consumedBySuggestionIds: [],
  createdAt: "2026-07-03T00:00:00.000Z",
  updatedAt: "2026-07-03T00:00:00.000Z"
});

const profile: Profile = {
  school: "唐山师范学院",
  major: "信息管理与信息系统",
  graduation: "2027-06",
  direction: "数据分析",
  items: []
};

describe("preference optimizer", () => {
  it("builds a prompt around title, industry, JD, labels, and correction context", () => {
    const prompt = buildPreferencePrompt({
      feedback: [feedback],
      currentRules: createDefaultPreferenceRules("2026-07-03T00:00:00.000Z"),
      profile,
      correction: "不要排除所有运营，只排除纯销售运营",
      previousCandidates: []
    });

    expect(prompt).toContain("门店销售");
    expect(prompt).toContain("生活服务");
    expect(prompt).toContain("电话邀约客户到店");
    expect(prompt).toContain("negative");
    expect(prompt).toContain("不要排除所有运营");
    expect(prompt).toContain("只有负反馈");
    expect(prompt).toContain("至少输出1条候选规则");
  });

  it("parses fenced structured candidates and returns model metadata", async () => {
    const optimizer = createDeepSeekPreferenceOptimizer({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      request: async () => ({
        choices: [{ message: { content: "```json\n{\"candidates\":[{\"tempId\":\"candidate-1\",\"action\":\"exclude\",\"field\":\"jd\",\"mode\":\"hard\",\"values\":[\"电话邀约\"],\"statement\":\"\",\"weight\":100,\"evidenceFeedbackIds\":[\"feedback-1\"],\"rationale\":\"纯销售\",\"confidence\":0.9}]}\n```" } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
      })
    });

    const result = await optimizer.analyze({
      feedback: [feedback],
      currentRules: [],
      profile,
      correction: "",
      previousCandidates: []
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({ field: "jd", values: ["电话邀约"] })
    ]);
    expect(result).toMatchObject({ provider: "deepseek", model: "deepseek-chat" });
    expect(result.estimatedCostCny).toBeGreaterThan(0);
  });

  it("rejects candidates that cite unknown feedback", async () => {
    const optimizer = createDeepSeekPreferenceOptimizer({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      request: async () => ({
        choices: [{ message: { content: JSON.stringify({ candidates: [{
          tempId: "candidate-1",
          action: "exclude",
          field: "title",
          mode: "hard",
          values: ["销售"],
          statement: "",
          weight: 100,
          evidenceFeedbackIds: ["unknown"],
          rationale: "",
          confidence: 0.7
        }] }) } }]
      })
    });

    await expect(optimizer.analyze({
      feedback: [feedback],
      currentRules: [],
      profile,
      correction: "",
      previousCandidates: []
    })).rejects.toThrow("unknown feedback");
  });

  it("rejects empty candidate responses instead of silently saving an empty draft", async () => {
    const optimizer = createDeepSeekPreferenceOptimizer({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      request: async () => ({
        choices: [{ message: { content: JSON.stringify({ candidates: [] }) } }]
      })
    });

    await expect(optimizer.analyze({
      feedback: [feedback],
      currentRules: [],
      profile,
      correction: "",
      previousCandidates: []
    })).rejects.toThrow("AI 没有生成候选规则");
  });

  it("fails clearly when no DeepSeek provider is configured", async () => {
    const optimizer = createConfiguredPreferenceOptimizer({});
    await expect(optimizer.analyze({
      feedback: [feedback],
      currentRules: [],
      profile,
      correction: "",
      previousCandidates: []
    })).rejects.toThrow("DeepSeek");
  });
});
