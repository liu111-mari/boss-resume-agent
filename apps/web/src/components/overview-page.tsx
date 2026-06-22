"use client";

import Link from "next/link";
import React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GreetingTask, JobCard } from "@boss-agent/shared";

import PageFeedback from "@/components/page-feedback";
import { EmptyState, MetricCard, PageHeader, Panel, StatusBadge } from "@/components/ui";
import { loadOverviewPageData, type WorkbenchOperationalData } from "@/lib/client-api";

type OverviewData = WorkbenchOperationalData | {
  jobs: JobCard[];
  tasks: GreetingTask[];
  runSummary: null;
};

export default function OverviewPage({ initialData }: { initialData?: OverviewData }) {
  const [data, setData] = useState<OverviewData | null>(initialData ?? null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const refresh = useCallback(async () => {
    try {
      setData(await loadOverviewPageData());
      setError("");
      setStatus("概览数据已更新。");
    } catch (cause) {
      setError(getErrorMessage(cause, "概览加载失败"));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!initialData) void refresh();
  }, [initialData, refresh]);

  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const recentTasks = useMemo(
    () => [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6),
    [tasks]
  );
  const recentLogs = data?.runSummary?.recentLogs.slice(0, 4) ?? [];

  return (
    <>
      <PageHeader
        actions={<button className="button button-secondary" onClick={() => void refresh()} type="button">刷新数据</button>}
        description="查看真实岗位、审批与发送状态。"
        title="今日概览"
      />
      <PageFeedback error={error} status={status} />
      <section className="overview-metrics">
        <MetricCard label="采集岗位" value={data?.jobs.length ?? 0} />
        <MetricCard label="待审批" tone="amber" value={countStatus(tasks, "pending_review")} />
        <MetricCard label="已批准" tone="teal" value={countStatus(tasks, "approved")} />
        <MetricCard label="今日发送" tone="teal" value={data?.runSummary?.usage.confirmedSends ?? 0} />
      </section>
      <div className="overview-layout">
        <Panel actions={<Link className="button button-primary" href="/approvals">查看审批队列</Link>} title="最近任务">
          {recentTasks.length ? (
            <div className="table-shell">
              <table className="data-table">
                <thead><tr><th>岗位</th><th>状态</th><th>模型</th><th>更新时间</th></tr></thead>
                <tbody>
                  {recentTasks.map((task) => (
                    <tr key={task.id}>
                      <td><strong>{task.jobTitle}</strong><span>{task.company}</span></td>
                      <td><StatusBadge label={task.status} /></td>
                      <td>{task.modelProvider}:{task.modelName}</td>
                      <td>{formatDateTime(task.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState description="采集岗位并运行筛选后，任务会显示在这里。" title="暂无任务" />
          )}
        </Panel>
        <Panel actions={<Link className="button button-secondary" href="/runs">查看运行记录</Link>} title="运行摘要">
          <dl className="overview-status-list">
            <div><dt>本地服务</dt><dd>{data?.runSummary ? "正常" : "等待确认"}</dd></div>
            <div><dt>每日上限</dt><dd>{data?.runSummary?.config.dailyLimit ?? 0}</dd></div>
            <div><dt>今日已发送</dt><dd>{data?.runSummary?.usage.confirmedSends ?? 0}</dd></div>
          </dl>
          <div className="recent-event-list">
            {recentLogs.map((log) => (
              <article className="recent-event" key={log.id}>
                <StatusBadge label={log.level} tone={log.level === "error" ? "danger" : log.level === "warn" ? "amber" : "teal"} />
                <div><strong>{log.message}</strong><span>{formatDateTime(log.createdAt)}</span></div>
              </article>
            ))}
            {!recentLogs.length ? <p className="empty-state">最近还没有运行日志。</p> : null}
          </div>
        </Panel>
      </div>
    </>
  );
}

function countStatus(tasks: GreetingTask[], status: GreetingTask["status"]) {
  return tasks.filter((task) => task.status === status).length;
}

function formatDateTime(value: string) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
