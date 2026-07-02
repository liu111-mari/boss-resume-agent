import React from "react";

import { MetricCard, Panel, StatusBadge } from "@/components/ui";

type ApprovalSendControlProps = {
  approvedCount: number;
  checking: boolean;
  connected: boolean;
  onRun: () => void;
  pausedCount: number;
  pendingCount: number;
  running: boolean;
};

export default function ApprovalSendControl({
  approvedCount,
  checking,
  connected,
  onRun,
  pausedCount,
  pendingCount,
  running
}: ApprovalSendControlProps) {
  const connectionLabel = checking ? "正在检测扩展" : connected ? "扩展已连接" : "扩展未连接";

  return (
    <Panel
      id="approval-send-control"
      title="平台默认招呼"
      description="确认列表无误后，扩展会逐个点击 BOSS 的沟通入口；不会发送审批页中的定制话术。"
      actions={
        <button
          className="button button-primary"
          disabled={approvedCount === 0 || checking || !connected || running}
          onClick={onRun}
          type="button"
        >
          {running ? "正在平台打招呼…" : `一键平台默认打招呼 ${approvedCount} 条`}
        </button>
      }
    >
      <div className="status-summary" aria-live="polite">
        <div className="status-inline">
          <span>浏览器扩展</span>
          <StatusBadge label={connectionLabel} tone={connected ? "teal" : "amber"} />
        </div>
        <div className="metrics-grid">
          <MetricCard label="待审批" value={pendingCount} />
          <MetricCard label="已暂停" tone="amber" value={pausedCount} />
          <MetricCard label="已批准待发送" tone="teal" value={approvedCount} />
        </div>
        {!connected && !checking ? (
          <p className="field-hint">请在 chrome://extensions 重新加载“BOSS 求职助手”，再刷新本页。</p>
        ) : null}
      </div>
    </Panel>
  );
}
