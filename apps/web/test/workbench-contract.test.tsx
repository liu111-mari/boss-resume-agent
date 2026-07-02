import React from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { FilterConfig, GreetingTask, Profile, ProfileItem } from "@boss-agent/shared";

import ApprovalQueue from "@/components/approval-queue";
import ApprovalSendControl from "@/components/approval-send-control";
import FilterSettings from "@/components/filter-settings";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const overviewRouteSource = readFileSync(path.resolve(testDir, "../src/app/(workbench)/page.tsx"), "utf8");
const approvalsRouteSource = readFileSync(path.resolve(testDir, "../src/app/(workbench)/approvals/page.tsx"), "utf8");
const runsRouteSource = readFileSync(path.resolve(testDir, "../src/app/(workbench)/runs/page.tsx"), "utf8");
const filtersPageSource = readFileSync(path.resolve(testDir, "../src/components/filters-page.tsx"), "utf8");
const filterSettingsSource = readFileSync(path.resolve(testDir, "../src/components/filter-settings.tsx"), "utf8");
const profileEditorSource = readFileSync(path.resolve(testDir, "../src/components/profile-editor.tsx"), "utf8");
const templateSettingsSource = readFileSync(path.resolve(testDir, "../src/components/template-settings.tsx"), "utf8");
const approvalQueueSource = readFileSync(path.resolve(testDir, "../src/components/approval-queue.tsx"), "utf8");
const approvalsPageSource = readFileSync(path.resolve(testDir, "../src/components/approvals-page.tsx"), "utf8");
const globalCssSource = readFileSync(path.resolve(testDir, "../src/app/globals.css"), "utf8");

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
  it("keeps the status grid inside a narrow mobile viewport", () => {
    expect(globalCssSource).toMatch(
      /\.status-summary\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s
    );
    expect(globalCssSource).toMatch(
      /\.log-list\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s
    );
  });
  it("routes overview, approvals, and runs to separate page containers", () => {
    expect(overviewRouteSource).toContain("OverviewPage");
    expect(approvalsRouteSource).toContain("ApprovalsPage");
    expect(runsRouteSource).toContain("RunsPage");
  });

  it("does not keep the legacy all-in-one route", () => {
    expect(() => readFileSync(path.resolve(testDir, "../src/app/page.tsx"), "utf8")).toThrow();
  });

  it("renders filter settings with a hard max of 150 for daily limit", () => {
    const html = renderToStaticMarkup(
      <FilterSettings
        config={createConfig({ dailyLimit: 150 })}
        lastRunCounts={null}
        onChange={vi.fn()}
        onOperationalRefresh={vi.fn()}
        onSaved={vi.fn()}
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
        onDraftChange={vi.fn()}
        onError={vi.fn()}
        onOperationalRefresh={vi.fn()}
        onRejectReasonChange={vi.fn()}
        onSelectionReset={vi.fn()}
        onSelectionChange={vi.fn()}
        onSelectAllApprovable={vi.fn()}
        onStatus={vi.fn()}
        onTaskSaved={vi.fn()}
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

  it("uses local save callbacks and keeps manual refresh scoped to operational data", () => {
    expect(filtersPageSource).toContain("const refreshOperationalData = useCallback");
    expect(filtersPageSource).not.toContain("const refreshAllData = useCallback");
    expect(filtersPageSource).toMatch(/<FilterSettings[\s\S]*onSaved=/);
    expect(filtersPageSource).toMatch(/<FilterSettings[\s\S]*onOperationalRefresh=/);
  });

  it("allows paused tasks to be selected and re-approved", () => {
    const html = renderToStaticMarkup(
      <ApprovalQueue
        profileItemsById={new Map()}
        rejectReason=""
        selectedTaskIds={[]}
        tasks={[createTask({ id: "task-paused", status: "paused" })]}
        onDraftChange={vi.fn()}
        onOperationalRefresh={vi.fn()}
        onRejectReasonChange={vi.fn()}
        onSelectionChange={vi.fn()}
        onSelectAllApprovable={vi.fn()}
        onTaskSaved={vi.fn()}
      />
    );

    expect(html).toContain("全选可审批");
    expect(html).toMatch(/aria-label="选择任务-[^"]+"(?![^>]*disabled)/);
    expect(approvalQueueSource).toContain("isApprovableTask");
    expect(approvalsPageSource).toContain("tasks.filter(isApprovableTask)");
  });

  it("renders a prominent extension-backed batch-send control", () => {
    const html = renderToStaticMarkup(
      <ApprovalSendControl
        approvedCount={42}
        checking={false}
        connected={true}
        onRun={vi.fn()}
        pausedCount={8}
        pendingCount={0}
        running={false}
      />
    );

    expect(html).toContain("一键平台默认打招呼 42 条");
    expect(html).toContain("不会发送审批页中的定制话术");
    expect(html).toContain("待审批");
    expect(html).toContain("已暂停");
    expect(html).toContain("扩展已连接");
    expect(approvalsPageSource).toContain("checkExtensionBridge");
    expect(approvalsPageSource).toContain("runApprovedTasksViaExtension");
    expect(approvalsPageSource).toMatch(/await refreshTasks\(\)/);
  });

  it("keeps save and run side effects inside panel components instead of calling page-wide refresh", () => {
    expect(filterSettingsSource).toContain("onSaved: (savedValue: FilterConfig) => void");
    expect(filterSettingsSource).toContain("onOperationalRefresh: () => Promise<void>");
    expect(filterSettingsSource).toContain("const nextConfig = buildValidatedConfig()");
    expect(filterSettingsSource).toMatch(/await saveConfig\(nextConfig\)/);
    expect(filterSettingsSource).toMatch(/await runPipeline\(\)/);
    expect(filterSettingsSource).toMatch(/onSaved\(savedConfig\.config\)/);
    expect(filterSettingsSource).toMatch(/await onOperationalRefresh\(\)/);

    expect(profileEditorSource).toContain("onSaved: (savedValue: Profile) => void");
    expect(profileEditorSource).toMatch(/await saveProfile\(profile\)/);
    expect(profileEditorSource).toMatch(/onSaved\(savedProfile\.profile\)/);

    expect(templateSettingsSource).toContain("onSaved: (savedValue: GreetingTemplate) => void");
    expect(templateSettingsSource).toContain("const nextTemplate = buildValidatedTemplate()");
    expect(templateSettingsSource).toMatch(/await saveTemplate\(nextTemplate\)/);
    expect(templateSettingsSource).toMatch(/onSaved\(savedTemplate\.template\)/);

    expect(approvalQueueSource).toContain("onTaskSaved: (task: GreetingTask) => void");
    expect(approvalQueueSource).toContain("onOperationalRefresh: () => Promise<void>");
    expect(approvalQueueSource).toMatch(/await updateTaskDraft\(/);
    expect(approvalQueueSource).toMatch(/onTaskSaved\(savedTask\.task\)/);
    expect(approvalQueueSource).toMatch(/await approveTasks\(/);
    expect(approvalQueueSource).toMatch(/await rejectTasks\(/);
    expect(approvalQueueSource).toMatch(/await onOperationalRefresh\(\)/);
  });

  it("edits the greeting structure separately from banned phrases", () => {
    expect(templateSettingsSource).toContain("话术结构模板");
    expect(templateSettingsSource).toContain("每次 DeepSeek");
    expect(templateSettingsSource).toMatch(
      /aria-label="话术结构模板"[\s\S]*onChange=\{\(event\) => onChange\(\{ \.\.\.template, body: event\.target\.value \}\)\}[\s\S]*value=\{template\.body\}/
    );
    expect(templateSettingsSource).toMatch(
      /aria-label="禁用词"[\s\S]*bannedPhrases: parseArrayInput\(event\.target\.value\)[\s\S]*value=\{template\.bannedPhrases\.join\("\\n"\)\}/
    );
  });
});
