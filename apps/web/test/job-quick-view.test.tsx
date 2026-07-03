import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { JobCard } from "@boss-agent/shared";
import JobQuickView from "@/components/job-quick-view";

function createJob(overrides: Partial<JobCard> = {}): JobCard {
  return {
    id: "job-1",
    title: "AI产品实习生",
    company: "小米",
    city: "北京",
    salary: "300-400元/天",
    hrName: "",
    hrActiveText: "",
    detailUrl: "https://www.zhipin.com/job_detail/demo.html",
    sourcePage: "boss",
    jdText: "负责AI产品调研、需求分析、原型验证和完整前后端Demo开发。熟练使用SQL，拒绝电话销售。",
    jdSource: "detail",
    experience: "在校/应届",
    education: "本科",
    industry: "互联网",
    rawText: "",
    direction: "AI产品",
    collectedAt: "2026-07-03T00:00:00.000Z",
    ...overrides
  };
}

describe("JobQuickView", () => {
  it("renders salary, scan-friendly JD excerpt, hover preview, detail drawer trigger and BOSS link", () => {
    const html = renderToStaticMarkup(
      <JobQuickView
        job={createJob()}
        negativeTerms={["电话销售"]}
        positiveTerms={["SQL", "需求分析"]}
      />
    );

    expect(html).toContain("AI产品实习生");
    expect(html).toContain("300-400元/天");
    expect(html).toContain("负责AI产品调研");
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("查看完整JD");
    expect(html).toContain("BOSS详情");
    expect(html).toContain("命中：SQL");
    expect(html).toContain("排除词：电话销售");
  });

  it("labels list-only or missing JD without pretending it is complete", () => {
    const html = renderToStaticMarkup(
      <JobQuickView job={createJob({ jdText: "", jdSource: "list", salary: "" })} />
    );

    expect(html).toContain("薪资待补全");
    expect(html).toContain("打开 BOSS 详情后可自动补全完整 JD");
  });
});
