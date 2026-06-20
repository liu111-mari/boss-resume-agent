import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { FilterConfig, GreetingTask, Profile, ProfileItem } from "@boss-agent/shared";

import ApprovalQueue from "@/components/approval-queue";
import FilterSettings from "@/components/filter-settings";
import Home from "@/app/page";

function createConfig(overrides: Partial<FilterConfig> = {}): FilterConfig {
  return {
    targetTitles: ["数据分析师实习生"],
    cities: ["北京", "上海"],
    salaryUnit: "month",
    minSalary: 5,
    maxSalary: 15,
    employmentTypes: ["internship"],
    requiredKeywords: ["SQL", "Python"],
    excludedKeywords: ["销售"],
    blockedCompanies: ["某培训机构"],
    blockedIndustries: ["咨询公司"],
    allowedExperience: ["在校/应届"],
    allowedEducation: ["本科及以上"],
    scoreThreshold: 70,
    dailyLimit: 80,
    ...overrides
  };
}

function createProfileItems(): ProfileItem[] {
  return [
    {
      id: "skill-sql",
      category: "skill",
      content: "熟悉 SQL、Python、Excel",
      tags: ["SQL", "Python"],
      enabled: true
    },
    {
      id: "project-dashboard",
      category: "project",
      content: "做过经营分析看板项目",
      tags: ["经营分析"],
      enabled: true
    }
  ];
}

function createProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    school: "复旦大学",
    major: "信息管理与信息系统",
    graduation: "2027-06",
    direction: "数据分析",
    items: createProfileItems(),
    ...overrides
  };
}

function createTask(overrides: Partial<GreetingTask> = {}): GreetingTask {
  return {
    id: "task-1",
    jobId: "job-1",
    jobTitle: "数据分析实习生",
    company: "上海数策科技",
    detailUrl: "https://example.com/jobs/1",
    messageDraft: "您好，我关注到贵司数据分析实习生岗位，熟悉 SQL、Python，也做过经营分析看板项目，期待进一步沟通。",
    status: "pending_review",
    score: 86,
    matchReasons: ["匹配要求：SQL、数据分析、Excel"],
    matchedRequirements: ["SQL", "数据分析", "Excel"],
    missingRequirements: [],
    usedProfileItemIds: ["skill-sql", "project-dashboard"],
    modelProvider: "deepseek",
    modelName: "deepseek-chat",
    scoringProvider: "deepseek",
    scoringModel: "deepseek-chat",
    refinementProvider: "local",
    refinementModel: "template",
    refinementFallback: true,
    templateVersion: 3,
    estimatedCostCny: 0.011,
    failureReason: "",
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    ...overrides
  };
}

describe("greeting workbench contract", () => {
  it("renders the required workbench sections and removes old resume or conversation UI", () => {
    const html = renderToStaticMarkup(<Home />);

    expect(html).toContain("筛选设置");
    expect(html).toContain("个人信息库");
    expect(html).toContain("话术设置");
    expect(html).toContain("待审批队列");
    expect(html).toContain("运行状态");

    expect(html).not.toContain("岗位版简历");
    expect(html).not.toContain("生成简历");
    expect(html).not.toContain("下载 DOCX");
    expect(html).not.toContain("消息线索");
  });

  it("renders accessible form labels for the main workbench inputs", () => {
    const html = renderToStaticMarkup(<Home />);

    expect(html).toContain(">目标职位<");
    expect(html).toContain(">城市<");
    expect(html).toContain(">薪资单位<");
    expect(html).toContain(">每日打招呼上限<");
    expect(html).toContain(">学校<");
    expect(html).toContain(">专业<");
    expect(html).toContain(">模板正文<");
  });

  it("renders filter settings with a hard max of 150 for daily limit", () => {
    const html = renderToStaticMarkup(
      <FilterSettings
        config={createConfig({ dailyLimit: 150 })}
        isSaving={false}
        isRunning={false}
        lastRunCounts={null}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onRun={vi.fn()}
      />
    );

    expect(html).toContain('name="dailyLimit"');
    expect(html).toContain('max="150"');
  });

  it("renders approval queue cards with textarea, score, reasons, cost, fallback and used profile content", () => {
    const html = renderToStaticMarkup(
      <ApprovalQueue
        profileItemsById={new Map(createProfile().items.map((item) => [item.id, item]))}
        rejectReason=""
        selectedTaskIds={[]}
        tasks={[
          createTask(),
          createTask({ id: "task-2", status: "approved", score: 92, refinementFallback: false })
        ]}
        isSubmitting={false}
        onDraftChange={vi.fn()}
        onRejectReasonChange={vi.fn()}
        onSelectionChange={vi.fn()}
        onSelectAllPending={vi.fn()}
        onApproveSelected={vi.fn()}
        onRejectSelected={vi.fn()}
      />
    );

    expect(html).toContain("数据分析实习生");
    expect(html).toContain("86");
    expect(html).toContain("匹配要求：SQL、数据分析、Excel");
    expect(html).toContain("熟悉 SQL、Python、Excel");
    expect(html).toContain("做过经营分析看板项目");
    expect(html).toContain("0.011");
    expect(html).toContain("回退");
    expect(html).toContain("textarea");
  });
});
