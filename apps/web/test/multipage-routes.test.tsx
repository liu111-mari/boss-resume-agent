import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { JobCard } from "@boss-agent/shared";

import JobsPage, { filterJobs } from "@/components/jobs-page";
import OverviewPage from "@/components/overview-page";

describe("multipage workbench responsibilities", () => {
  it("keeps the overview focused on real summaries and shortcuts", () => {
    const html = renderToStaticMarkup(
      <OverviewPage initialData={{ jobs: [], tasks: [], runSummary: null }} />
    );
    expect(html).toContain("今日概览");
    expect(html).toContain("查看审批队列");
    expect(html).not.toContain("目标职位");
    expect(html).not.toContain("模板正文");
  });

  it("shows collection instructions when the job library is empty", () => {
    const html = renderToStaticMarkup(<JobsPage initialJobs={[]} />);
    expect(html).toContain("还没有采集岗位");
    expect(html).toContain("BOSS 搜索结果页");
  });

  it("searches real jobs by title, company, or city", () => {
    const jobs: JobCard[] = [
      createJob({ id: "job-1", title: "数据分析实习生", company: "数策科技", city: "上海" }),
      createJob({ id: "job-2", title: "AI 产品经理", company: "智造未来", city: "北京" })
    ];

    expect(filterJobs(jobs, "数据")).toHaveLength(1);
    expect(filterJobs(jobs, "智造")).toHaveLength(1);
    expect(filterJobs(jobs, "上海")).toHaveLength(1);
  });
});

function createJob(overrides: Partial<JobCard>): JobCard {
  return {
    id: "job",
    title: "岗位",
    company: "公司",
    city: "城市",
    salary: "",
    hrName: "",
    hrActiveText: "",
    detailUrl: "",
    sourcePage: "boss",
    jdText: "",
    experience: "",
    education: "",
    industry: "",
    rawText: "",
    direction: "其他",
    collectedAt: "2026-06-22T00:00:00.000Z",
    ...overrides
  };
}
