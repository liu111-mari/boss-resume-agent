"use client";

import React from "react";
import { useEffect, useMemo, useState } from "react";
import type { FilterConfig, JobCard, PreferenceFocusField } from "@boss-agent/shared";

import JobQuickView from "@/components/job-quick-view";
import PageFeedback from "@/components/page-feedback";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { checkExtensionBridge, runJobEnrichmentViaExtension } from "@/lib/extension-bridge";
import {
  createTasksFromJobs,
  fetchJobsWorkbook,
  loadJobsPageData,
  loadFiltersPageData,
  submitJobFeedback,
  undoJobFeedback,
  type CreateTasksFromJobsCounts,
  type JobFeedbackAction
} from "@/lib/client-api";
import { getJobExportStats } from "@/lib/job-export";

export default function JobsPage({ initialJobs }: { initialJobs?: JobCard[] }) {
  const [jobs, setJobs] = useState(initialJobs ?? []);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [focusFields, setFocusFields] = useState<PreferenceFocusField[]>([
    "title",
    "industry",
    "jdResponsibilities"
  ]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastFeedbackIds, setLastFeedbackIds] = useState<string[]>([]);
  const [filterConfig, setFilterConfig] = useState<FilterConfig | null>(null);

  useEffect(() => {
    const jobsRequest = initialJobs ? Promise.resolve(initialJobs) : loadJobsPageData();
    void Promise.all([jobsRequest, loadFiltersPageData()])
      .then(([loadedJobs, loadedConfig]) => {
        setJobs(loadedJobs);
        setFilterConfig(loadedConfig);
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "岗位加载失败");
      });
  }, [initialJobs]);

  useEffect(() => {
    const refreshAfterDetailVisit = () => {
      void loadJobsPageData().then(setJobs).catch(() => undefined);
    };
    window.addEventListener("focus", refreshAfterDetailVisit);
    return () => window.removeEventListener("focus", refreshAfterDetailVisit);
  }, []);

  const visibleJobs = useMemo(() => filterJobs(jobs, query), [jobs, query]);
  const selectedJobIdSet = useMemo(() => new Set(selectedJobIds), [selectedJobIds]);
  const allJobsSelected = jobs.length > 0 && jobs.every((job) => selectedJobIdSet.has(job.id));
  const exportStats = useMemo(() => getJobExportStats(jobs), [jobs]);

  async function runAction(jobIds: string[], action: JobFeedbackAction) {
    if (jobIds.length === 0 || busy) return;
    if (
      action !== "favorite" &&
      typeof window !== "undefined" &&
      !window.confirm(getJobActionConfirmation(action, jobIds.length))
    ) return;

    setBusy(true);
    setError("");
    try {
      const result = await submitJobFeedback({ jobIds, action, focusFields, note });
      if (result.removedJobIds.length > 0) {
        const removed = new Set(result.removedJobIds);
        setJobs((current) => current.filter((job) => !removed.has(job.id)));
      }
      setSelectedJobIds([]);
      setLastFeedbackIds(result.feedback.map((item) => item.id));
      setStatus(
        action === "favorite"
          ? `已记录 ${result.feedback.length} 条重点关注反馈。`
          : `已移除 ${result.removedJobIds.length} 个岗位，取消 ${result.canceledTaskIds.length} 个未发送任务${result.blockedJobIds.length ? `，${result.blockedJobIds.length} 个发送中岗位未处理` : ""}。`
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "岗位操作失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleUndo() {
    if (lastFeedbackIds.length === 0 || busy) return;
    setBusy(true);
    try {
      for (const feedbackId of lastFeedbackIds) await undoJobFeedback(feedbackId);
      setJobs(await loadJobsPageData());
      setLastFeedbackIds([]);
      setStatus("已撤销上次偏好反馈并恢复被移除岗位；旧任务不会自动重新批准。");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "撤销失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateApproval() {
    if (selectedJobIds.length === 0 || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await createTasksFromJobs(selectedJobIds);
      setStatus(formatManualApprovalResult(response.counts));
      if (response.counts.pendingReview > 0) {
        setSelectedJobIds([]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加入审批队列失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleExport(jobIds?: string[]) {
    if (busy) return;
    const exportJobs = jobIds?.length
      ? jobs.filter((job) => jobIds.includes(job.id))
      : jobs;
    const stats = getJobExportStats(exportJobs);
    if (
      stats.missingJd > 0 &&
      typeof window !== "undefined" &&
      !window.confirm(
        `将导出 ${stats.total} 个岗位，其中完整 JD ${stats.completeJd} 个、缺失 ${stats.missingJd} 个。是否继续导出当前数据？`
      )
    ) return;

    setBusy(true);
    setError("");
    try {
      const { blob, filename } = await fetchJobsWorkbook(jobIds);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setStatus(`已导出 ${stats.total} 个岗位，其中完整 JD ${stats.completeJd} 个。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "岗位表导出失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleEnrichment() {
    if (busy) return;
    const incompleteJobs = jobs
      .filter((job) => getJobExportStats([job]).missingJd > 0 && job.detailUrl)
      .map((job) => ({ id: job.id, detailUrl: job.detailUrl }));
    if (incompleteJobs.length === 0) {
      setStatus("当前岗位已经包含完整 JD，或缺失岗位没有可用详情链接。");
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `将依次打开 ${incompleteJobs.length} 个 BOSS 详情页补全信息。遇到登录、验证码或安全提示会立即暂停。是否继续？`
      )
    ) return;

    setBusy(true);
    setError("");
    setStatus(`正在补全 ${incompleteJobs.length} 个岗位，请保持 BOSS 登录并不要关闭浏览器。`);
    try {
      await checkExtensionBridge({ timeoutMs: 3_000 });
      const result = await runJobEnrichmentViaExtension(incompleteJobs);
      setJobs(await loadJobsPageData());
      if (!result.ok) {
        setError(result.message);
      } else {
        setStatus(result.message);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "岗位详情补全失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader description="快速查看薪资和 JD；打开 BOSS 详情页后，插件会自动回填完整 JD。" title="岗位库" />
      <PageFeedback error={error} status={status} />
      <Panel title={`岗位列表（共 ${jobs.length} 个${query ? `，匹配 ${visibleJobs.length} 个` : ""}）`}>
        {!jobs.length ? (
          <EmptyState description="请先在 BOSS 搜索结果页打开插件并点击采集岗位。" title="还没有采集岗位" />
        ) : (
          <>
            <label className="field job-search">
              <span>搜索岗位、公司或城市</span>
              <input
                aria-label="搜索岗位、公司或城市"
                className="input"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="例如：数据分析、数策科技、上海"
                type="search"
                value={query}
              />
            </label>
            <div className="preference-toolbar">
              <strong>完整 JD：{exportStats.completeJd} / {exportStats.total}（缺失 {exportStats.missingJd}）</strong>
              <div className="panel-actions-row">
                <button className="button button-primary" disabled={busy || jobs.length === 0} onClick={() => void handleExport()} type="button">导出全部岗位</button>
                <button className="button button-secondary" disabled={busy || selectedJobIds.length === 0} onClick={() => void handleExport(selectedJobIds)} type="button">导出选中岗位</button>
                <button className="button button-secondary" disabled={busy || exportStats.missingJd === 0} onClick={() => void handleEnrichment()} type="button">补全缺失详情</button>
              </div>
            </div>
            <div className="preference-toolbar">
              <strong>批量处理选中岗位（{selectedJobIds.length}）</strong>
              <div className="preference-focus-fields" aria-label="反馈重点">
                <span>反馈重点</span>
                {focusFieldOptions.map((option) => (
                  <label className="checkbox-field" key={option.value}>
                    <input
                      checked={focusFields.includes(option.value)}
                      onChange={(event) => setFocusFields((current) =>
                        event.target.checked
                          ? Array.from(new Set([...current, option.value]))
                          : current.filter((item) => item !== option.value)
                      )}
                      type="checkbox"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              <label className="field preference-note">
                <span>补充说明</span>
                <input
                  className="input"
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="例如：不要排除所有运营，只排除纯销售运营"
                  value={note}
                />
              </label>
              <div className="panel-actions-row">
                <button className="button button-secondary" disabled={busy || jobs.length === 0} onClick={() => setSelectedJobIds((current) => toggleAllJobIds(jobs, current))} type="button">
                  {allJobsSelected ? "取消全选" : "全选全部岗位"}
                </button>
                <button className="button button-primary" disabled={busy || selectedJobIds.length === 0} onClick={() => void handleCreateApproval()} type="button">加入审批队列</button>
                <button className="button button-secondary" disabled={busy || selectedJobIds.length === 0} onClick={() => void runAction(selectedJobIds, "favorite")} type="button">重点关注</button>
                <button className="button button-danger" disabled={busy || selectedJobIds.length === 0} onClick={() => void runAction(selectedJobIds, "negative_remove")} type="button">不喜欢并移除</button>
                <button className="button button-danger-ghost" disabled={busy || selectedJobIds.length === 0} onClick={() => void runAction(selectedJobIds, "remove")} type="button">普通移除</button>
                {lastFeedbackIds.length ? <button className="button button-ghost" disabled={busy} onClick={() => void handleUndo()} type="button">撤销上次偏好反馈</button> : null}
              </div>
            </div>
            <div className="table-shell">
              <table className="data-table job-table">
                <thead><tr><th>选择</th><th>岗位 / 薪资 / JD</th><th>经验 / 学历</th><th>方向 / 行业</th><th>采集时间</th><th>操作</th></tr></thead>
                <tbody>
                  {visibleJobs.map((job) => (
                    <tr key={job.id}>
                      <td><input aria-label={`选择岗位-${job.title}-${job.company}`} checked={selectedJobIds.includes(job.id)} onChange={(event) => setSelectedJobIds((current) => event.target.checked ? Array.from(new Set([...current, job.id])) : current.filter((id) => id !== job.id))} type="checkbox" /></td>
                      <td className="job-summary-cell"><JobQuickView job={job} negativeTerms={filterConfig?.excludedKeywords} positiveTerms={filterConfig ? [...filterConfig.targetTitles, ...filterConfig.requiredKeywords] : []} /></td>
                      <td>{[job.experience, job.education].filter(Boolean).join(" / ") || "未记录"}</td>
                      <td>{[job.direction, job.industry].filter(Boolean).join(" / ") || "未记录"}</td>
                      <td>{formatDateTime(job.collectedAt)}</td>
                      <td><div className="job-row-actions">
                        <button className="table-link button-link" disabled={busy} onClick={() => void runAction([job.id], "favorite")} type="button">重点关注</button>
                        <button className="table-link button-link" disabled={busy} onClick={() => void runAction([job.id], "negative_remove")} type="button">不喜欢并移除</button>
                        <button className="table-link button-link" disabled={busy} onClick={() => void runAction([job.id], "remove")} type="button">普通移除</button>
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visibleJobs.length ? <p className="empty-state">没有匹配当前搜索的岗位。</p> : null}
            </div>
          </>
        )}
      </Panel>
    </>
  );
}

const focusFieldOptions: Array<{ value: PreferenceFocusField; label: string }> = [
  { value: "title", label: "岗位名称" },
  { value: "industry", label: "行业" },
  { value: "jdResponsibilities", label: "JD工作内容" },
  { value: "jdRequirements", label: "JD任职要求" },
  { value: "other", label: "其他" }
];

export function filterJobs(jobs: JobCard[], query: string): JobCard[] {
  const keyword = query.trim().toLocaleLowerCase("zh-CN");
  if (!keyword) return jobs;
  return jobs.filter((job) =>
    [job.title, job.company, job.city].join(" ").toLocaleLowerCase("zh-CN").includes(keyword)
  );
}

export function toggleAllJobIds(jobs: JobCard[], selectedJobIds: string[]): string[] {
  const selectedJobIdSet = new Set(selectedJobIds);
  const allSelected = jobs.length > 0 && jobs.every((job) => selectedJobIdSet.has(job.id));
  return allSelected ? [] : jobs.map((job) => job.id);
}

export function formatManualApprovalResult(counts: CreateTasksFromJobsCounts): string {
  const issues: string[] = [];
  if (counts.skippedActive > 0) issues.push(`${counts.skippedActive} 个已有活动任务`);
  if (counts.notFound > 0) issues.push(`${counts.notFound} 个岗位不存在`);
  if (counts.failed > 0) issues.push(`${counts.failed} 个创建失败`);
  return `已加入待审批 ${counts.pendingReview} 个${issues.length ? `；${issues.join("，")}` : ""}。`;
}

export function getJobActionConfirmation(action: JobFeedbackAction, count: number): string {
  return action === "negative_remove"
    ? `确认将选中的 ${count} 个岗位标记为不喜欢并移除？这些岗位将用于AI学习。`
    : `确认普通移除选中的 ${count} 个岗位？此操作不用于AI学习。`;
}

function formatDateTime(value: string) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
}
