"use client";

import React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  FilterConfig,
  GreetingTask,
  GreetingTemplate,
  Profile
} from "@boss-agent/shared";

import ApprovalQueue from "@/components/approval-queue";
import FilterSettings from "@/components/filter-settings";
import ProfileEditor from "@/components/profile-editor";
import RunStatus from "@/components/run-status";
import TemplateSettings from "@/components/template-settings";
import { MetricCard, SectionAnchorNav } from "@/components/ui";
import {
  loadWorkbenchData,
  loadOperationalData,
  type WorkbenchData
} from "@/lib/client-api";
import type { GreetingPipelineRunCounts } from "@/lib/greeting-pipeline";

const anchorItems = [
  { href: "#overview", label: "概览" },
  { href: "#filter-settings", label: "筛选设置" },
  { href: "#profile-editor", label: "个人信息库" },
  { href: "#template-settings", label: "话术设置" },
  { href: "#approval-queue", label: "待审批队列" },
  { href: "#run-status", label: "运行状态" }
];

const defaultConfig: FilterConfig = {
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
};

const defaultProfile: Profile = {
  school: "",
  major: "",
  graduation: "",
  direction: "",
  items: []
};

const defaultTemplate: GreetingTemplate = {
  body: "",
  tone: "自然",
  minLength: 30,
  maxLength: 120,
  maxSkills: 2,
  maxProjects: 1,
  bannedPhrases: [],
  version: 1
};

export default function Home() {
  const [config, setConfig] = useState<FilterConfig>(defaultConfig);
  const [profile, setProfile] = useState<Profile>(defaultProfile);
  const [template, setTemplate] = useState<GreetingTemplate>(defaultTemplate);
  const [tasks, setTasks] = useState<GreetingTask[]>([]);
  const [jobsCount, setJobsCount] = useState(0);
  const [runSummary, setRunSummary] = useState<WorkbenchData["runSummary"] | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("正在加载工作台数据。");
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [serviceHealthy, setServiceHealthy] = useState(false);
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [rejectReason, setRejectReason] = useState("");
  const [lastRunCounts, setLastRunCounts] = useState<GreetingPipelineRunCounts | null>(null);

  const refreshOperationalData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const data = await loadOperationalData();
      applyOperationalData(data, setTasks, setJobsCount, setRunSummary, setDraftEdits);
      setServiceHealthy(true);
      setErrorMessage("");
      setStatusMessage("运行数据已同步。");
    } catch (error) {
      setServiceHealthy(false);
      setErrorMessage(getErrorMessage(error));
      setStatusMessage("运行数据同步失败。");
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const refreshAllData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const data = await loadWorkbenchData();
      applyWorkbenchData(data, setConfig, setProfile, setTemplate, setTasks, setJobsCount, setRunSummary, setDraftEdits);
      setServiceHealthy(true);
      setErrorMessage("");
      setStatusMessage("工作台数据已同步。");
    } catch (error) {
      setServiceHealthy(false);
      setErrorMessage(getErrorMessage(error));
      setStatusMessage("工作台同步失败。");
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let isActive = true;

    async function loadInitialData() {
      try {
        const data = await loadWorkbenchData();
        if (!isActive) return;

        applyWorkbenchData(data, setConfig, setProfile, setTemplate, setTasks, setJobsCount, setRunSummary, setDraftEdits);
        setServiceHealthy(true);
        setErrorMessage("");
        setStatusMessage("工作台数据已同步。");
      } catch (error) {
        if (!isActive) return;

        setServiceHealthy(false);
        setErrorMessage(getErrorMessage(error));
        setStatusMessage("工作台同步失败。");
      } finally {
        if (isActive) {
          setIsRefreshing(false);
        }
      }
    }

    void loadInitialData();

    return () => {
      isActive = false;
    };
  }, []);

  const profileItemsById = useMemo(
    () => new Map(profile.items.map((item) => [item.id, item])),
    [profile.items]
  );

  const pendingReviewCount = tasks.filter((task) => task.status === "pending_review").length;
  const approvedCount = tasks.filter((task) => task.status === "approved").length;

  const handleConfigSaved = useCallback((savedValue: FilterConfig) => {
    setConfig(savedValue);
  }, []);

  const handleProfileSaved = useCallback((savedValue: Profile) => {
    setProfile(savedValue);
  }, []);

  const handleTemplateSaved = useCallback((savedValue: GreetingTemplate) => {
    setTemplate(savedValue);
  }, []);

  const updateDraftValue = useCallback((taskId: string, value: string) => {
    setDraftEdits((current) => ({
      ...current,
      [taskId]: value
    }));
  }, []);

  const handleTaskSaved = useCallback((savedTask: GreetingTask) => {
    setTasks((current) => current.map((task) => (task.id === savedTask.id ? savedTask : task)));
    setDraftEdits((current) => ({
      ...current,
      [savedTask.id]: savedTask.messageDraft
    }));
  }, []);

  const updateTaskSelection = useCallback((taskId: string, checked: boolean) => {
    setSelectedTaskIds((current) =>
      checked ? Array.from(new Set([...current, taskId])) : current.filter((item) => item !== taskId)
    );
  }, []);

  const selectAllPending = useCallback(() => {
    setSelectedTaskIds(tasks.filter((task) => task.status === "pending_review").map((task) => task.id));
  }, [tasks]);

  const resetQueueSelection = useCallback(() => {
    setSelectedTaskIds([]);
    setRejectReason("");
  }, []);

  return (
    <div className="workbench-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <strong>BOSS 打招呼工作台</strong>
          <span>白底、窄侧栏、审批主导，不装饰旧功能。</span>
        </div>
        <SectionAnchorNav className="sidebar-nav" items={anchorItems} />
      </aside>

      <main className="workbench-main">
        <header className="topbar">
          <div>
            <h1>打招呼工作台</h1>
            <p>真实功能优先：筛选、素材、模板、审批、运行状态。</p>
          </div>
          <div className="topbar-status-group">
            <button className="button button-secondary" onClick={() => void refreshAllData()} type="button">
              全部刷新
            </button>
            <span aria-live="polite" className="status-text">
              {serviceHealthy ? "本地服务正常" : "等待服务确认"}
            </span>
          </div>
        </header>

        <SectionAnchorNav className="mobile-nav" items={anchorItems} />

        <section className="overview-grid" id="overview">
          <MetricCard label="采集岗位总数" tone="default" value={jobsCount} />
          <MetricCard label="待审数" tone="amber" value={pendingReviewCount} />
          <MetricCard label="已批准数" tone="teal" value={approvedCount} />
          <MetricCard label="今日发送数" tone="teal" value={runSummary?.usage.confirmedSends ?? 0} />
        </section>

        <div aria-live="polite" className="notice-stack">
          <div className="notice">{statusMessage}</div>
          {errorMessage ? <div className="notice notice-danger">{errorMessage}</div> : null}
        </div>

        <section className="workspace">
          <div className="workspace-column">
            <FilterSettings
              config={config}
              lastRunCounts={lastRunCounts}
              onChange={setConfig}
              onError={setErrorMessage}
              onOperationalRefresh={refreshOperationalData}
              onRunCompleted={setLastRunCounts}
              onSaved={handleConfigSaved}
              onStatus={setStatusMessage}
            />

            <ProfileEditor
              onChange={setProfile}
              onError={setErrorMessage}
              onSaved={handleProfileSaved}
              onStatus={setStatusMessage}
              profile={profile}
            />

            <TemplateSettings
              onChange={setTemplate}
              onError={setErrorMessage}
              onSaved={handleTemplateSaved}
              onStatus={setStatusMessage}
              tasks={tasks}
              template={template}
            />
          </div>

          <div className="workspace-column workspace-column-right">
            <ApprovalQueue
              draftEdits={draftEdits}
              onDraftChange={updateDraftValue}
              onError={setErrorMessage}
              onOperationalRefresh={refreshOperationalData}
              onRejectReasonChange={setRejectReason}
              onSelectionReset={resetQueueSelection}
              onSelectAllPending={selectAllPending}
              onSelectionChange={updateTaskSelection}
              onStatus={setStatusMessage}
              onTaskSaved={handleTaskSaved}
              profileItemsById={profileItemsById}
              rejectReason={rejectReason}
              selectedTaskIds={selectedTaskIds}
              tasks={tasks}
            />

            <RunStatus
              isRefreshing={isRefreshing}
              onRefresh={refreshOperationalData}
              runSummary={runSummary}
              serviceHealthy={serviceHealthy}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

function applyWorkbenchData(
  data: WorkbenchData,
  setConfig: (value: FilterConfig) => void,
  setProfile: (value: Profile) => void,
  setTemplate: (value: GreetingTemplate) => void,
  setTasks: (value: GreetingTask[]) => void,
  setJobsCount: (value: number) => void,
  setRunSummary: (value: WorkbenchData["runSummary"]) => void,
  setDraftEdits: (updater: (current: Record<string, string>) => Record<string, string>) => void
) {
  setConfig(data.config);
  setProfile(data.profile);
  setTemplate(data.template);
  setTasks(data.tasks);
  setJobsCount(data.jobs.length);
  setRunSummary(data.runSummary);
  setDraftEdits(() =>
    Object.fromEntries(data.tasks.map((task) => [task.id, task.messageDraft]))
  );
}

function applyOperationalData(
  data: {
    jobs: WorkbenchData["jobs"];
    tasks: GreetingTask[];
    runSummary: WorkbenchData["runSummary"];
  },
  setTasks: (value: GreetingTask[]) => void,
  setJobsCount: (value: number) => void,
  setRunSummary: (value: WorkbenchData["runSummary"]) => void,
  setDraftEdits: (updater: (current: Record<string, string>) => Record<string, string>) => void
) {
  setTasks(data.tasks);
  setJobsCount(data.jobs.length);
  setRunSummary(data.runSummary);
  setDraftEdits((current) =>
    Object.fromEntries(
      data.tasks.map((task) => [task.id, current[task.id] ?? task.messageDraft])
    )
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
