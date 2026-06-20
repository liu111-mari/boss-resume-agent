import React from "react";
import type { GreetingTaskStatus } from "@boss-agent/shared";

import { MetricCard, Panel, StatusBadge } from "@/components/ui";
import type { WorkbenchRunSummary } from "@/lib/client-api";

type RunStatusProps = {
  runSummary: WorkbenchRunSummary | null;
  serviceHealthy: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
};

export default function RunStatus({
  runSummary,
  serviceHealthy,
  isRefreshing,
  onRefresh
}: RunStatusProps) {
  const statusCounts = runSummary?.taskStatusCounts ?? {};

  return (
    <Panel
      id="run-status"
      title="运行状态"
      description="这里只展示真实汇总与最近日志，不预设“已连接”。"
      actions={
        <div className="panel-actions-row">
          <a className="button button-secondary" href="/api/diagnostics/export">
            导出诊断
          </a>
          <button className="button button-secondary" disabled={isRefreshing} onClick={onRefresh} type="button">
            刷新
          </button>
        </div>
      }
    >
      <div className="status-summary" aria-live="polite">
        <div className="status-inline">
          <span>连接状态</span>
          <StatusBadge label={serviceHealthy ? "本地服务正常" : "尚未确认服务状态"} tone={serviceHealthy ? "teal" : "amber"} />
        </div>

        <div className="metrics-grid">
          <MetricCard
            helper={`日期 ${runSummary?.date ?? "—"}`}
            label="今日确认发送"
            tone="teal"
            value={runSummary?.usage.confirmedSends ?? 0}
          />
          <MetricCard
            helper={`上限 ${runSummary?.config.dailyLimit ?? 0}`}
            label="每日上限"
            tone="amber"
            value={runSummary?.config.dailyLimit ?? 0}
          />
          <MetricCard label="待审批" value={statusCounts.pending_review ?? 0} />
          <MetricCard label="已批准" value={statusCounts.approved ?? 0} />
        </div>

        <div className="status-counts">
          {statusOrder.map((status) => (
            <div className="status-count-row" key={status}>
              <span>{status}</span>
              <strong>{statusCounts[status] ?? 0}</strong>
            </div>
          ))}
        </div>

        <div className="log-list">
          {runSummary?.recentLogs.length ? (
            runSummary.recentLogs.map((log) => (
              <article className="log-item" key={log.id}>
                <div className="log-item-header">
                  <StatusBadge label={log.level} tone={log.level === "error" ? "danger" : log.level === "warn" ? "amber" : "teal"} />
                  <span>{log.createdAt}</span>
                </div>
                <strong>{log.message}</strong>
                {log.detail ? <p>{log.detail}</p> : null}
              </article>
            ))
          ) : (
            <p className="empty-state">最近还没有运行日志。</p>
          )}
        </div>
      </div>
    </Panel>
  );
}

const statusOrder: GreetingTaskStatus[] = [
  "pending_review",
  "approved",
  "sending",
  "paused",
  "quota_blocked",
  "sent",
  "rejected",
  "failed"
];
