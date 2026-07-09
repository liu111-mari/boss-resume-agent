import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  createDefaultPreferenceRules,
  preferenceSuggestionBatchSchema,
  type JobCard
} from "@boss-agent/shared";
import {
  formatManualApprovalResult,
  getJobActionConfirmation,
  toggleAllJobIds,
  default as JobsPage
} from "@/components/jobs-page";
import PreferenceLearning from "@/components/preference-learning";

const job: JobCard = {
  id: "job-1",
  title: "数据分析实习生",
  company: "数策科技",
  city: "北京",
  salary: "200-300元/天",
  hrName: "",
  hrActiveText: "",
  detailUrl: "https://www.zhipin.com/job_detail/job-1.html",
  sourcePage: "boss",
  jdText: "使用 SQL 完成经营分析",
  jdSource: "detail",
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
    expect(html).toContain("全选全部岗位");
    expect(html).toContain("加入审批队列");
    expect(html).toContain("完整 JD：1 / 1");
    expect(html).toContain("导出全部岗位");
    expect(html).toContain("导出选中岗位");
    expect(html).toContain("补全缺失详情");
    expect(html).toContain("使用 SQL 完成经营分析");
    expect(html).toContain("200-300元/天");
    expect(html).toContain("BOSS详情");
    expect(html).toContain('role="tooltip"');
  });

  it("selects every job in the library and toggles back to none", () => {
    const anotherJob = { ...job, id: "job-2", title: "商业分析实习生" };

    expect(toggleAllJobIds([job, anotherJob], [])).toEqual(["job-1", "job-2"]);
    expect(toggleAllJobIds([job, anotherJob], ["job-1", "job-2"])).toEqual([]);
  });

  it("shows the selected count and AI-learning behavior before removal", () => {
    expect(getJobActionConfirmation("remove", 89)).toBe(
      "确认普通移除选中的 89 个岗位？此操作不用于AI学习。"
    );
  });

  it("explains every manual approval outcome instead of reporting a silent no-op", () => {
    expect(formatManualApprovalResult({
      requested: 4,
      processed: 2,
      hardRejected: 0,
      pendingReview: 2,
      approved: 0,
      skipped: 1,
      skippedActive: 1,
      notFound: 1,
      failed: 0
    })).toBe("已加入待审批 2 个；1 个已有活动任务，1 个岗位不存在。");
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
