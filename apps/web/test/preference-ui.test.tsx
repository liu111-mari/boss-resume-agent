import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  createDefaultPreferenceRules,
  preferenceSuggestionBatchSchema,
  type JobCard
} from "@boss-agent/shared";
import JobsPage from "@/components/jobs-page";
import PreferenceLearning from "@/components/preference-learning";

const job: JobCard = {
  id: "job-1",
  title: "数据分析实习生",
  company: "数策科技",
  city: "北京",
  salary: "200-300元/天",
  hrName: "",
  hrActiveText: "",
  detailUrl: "",
  sourcePage: "boss",
  jdText: "使用 SQL 完成经营分析",
  experience: "在校/应届",
  education: "本科",
  industry: "企业服务",
  rawText: "",
  direction: "数据分析",
  collectedAt: "2026-07-03T00:00:00.000Z"
};

describe("job preference UI", () => {
  it("renders explicit positive, negative-remove, neutral-remove, and batch controls", () => {
    const html = renderToStaticMarkup(<JobsPage initialJobs={[job]} />);

    expect(html).toContain("选择岗位-数据分析实习生-数策科技");
    expect(html).toContain("重点关注");
    expect(html).toContain("不喜欢并移除");
    expect(html).toContain("普通移除");
    expect(html).toContain("反馈重点");
    expect(html).toContain("补充说明");
    expect(html).toContain("批量处理选中岗位");
  });

  it("renders feedback readiness, editable rules, candidate correction, preview, and apply controls", () => {
    const now = "2026-07-03T00:00:00.000Z";
    const batch = preferenceSuggestionBatchSchema.parse({
      id: "batch-1",
      feedbackIds: ["f1", "f2", "f3", "f4", "f5"],
      currentRuleIds: [],
      correction: "",
      candidates: [{
        tempId: "candidate-1",
        action: "exclude",
        field: "title",
        mode: "hard",
        values: ["销售"],
        statement: "",
        weight: 100,
        evidenceFeedbackIds: ["f1"],
        rationale: "多个负样本",
        confidence: 0.9
      }],
      status: "draft",
      provider: "deepseek",
      model: "deepseek-chat",
      estimatedCostCny: 0.01,
      createdAt: now,
      updatedAt: now
    });
    const html = renderToStaticMarkup(<PreferenceLearning initialState={{
      feedback: [],
      rules: createDefaultPreferenceRules(now),
      ruleHistory: [],
      suggestions: [batch],
      newFeedbackCount: 5
    }} />);

    expect(html).toContain("偏好学习");
    expect(html).toContain("5 条新反馈，可生成建议");
    expect(html).toContain("生成优化建议");
    expect(html).toContain("让 AI 重新生成");
    expect(html).toContain("预览影响");
    expect(html).toContain("应用选中建议");
    expect(html).toContain("当前生效规则");
    expect(html).toContain("禁用");
    expect(html).toContain("锁定");
    expect(html).toContain("删除规则");
    expect(html).toContain("拒绝此建议");
  });
});
