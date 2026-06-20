import React from "react";
import type { GreetingTask, GreetingTaskStatus, ProfileItem } from "@boss-agent/shared";

import { Panel, StatusBadge } from "@/components/ui";

type ApprovalQueueProps = {
  tasks: GreetingTask[];
  profileItemsById: Map<string, ProfileItem>;
  selectedTaskIds: string[];
  draftEdits?: Record<string, string>;
  rejectReason: string;
  isSubmitting: boolean;
  savingTaskIds?: string[];
  onDraftChange: (taskId: string, value: string) => void;
  onSaveDraft?: (taskId: string) => void;
  onRejectReasonChange: (value: string) => void;
  onSelectionChange: (taskId: string, checked: boolean) => void;
  onSelectAllPending: () => void;
  onApproveSelected: () => void;
  onRejectSelected: () => void;
};

const visibleStatuses = new Set<GreetingTaskStatus>([
  "pending_review",
  "approved",
  "sending",
  "paused",
  "quota_blocked"
]);

export default function ApprovalQueue({
  tasks,
  profileItemsById,
  selectedTaskIds,
  draftEdits = {},
  rejectReason,
  isSubmitting,
  savingTaskIds = [],
  onDraftChange,
  onSaveDraft,
  onRejectReasonChange,
  onSelectionChange,
  onSelectAllPending,
  onApproveSelected,
  onRejectSelected
}: ApprovalQueueProps) {
  const visibleTasks = tasks.filter((task) => visibleStatuses.has(task.status));
  const pendingReviewTasks = visibleTasks.filter((task) => task.status === "pending_review");

  return (
    <Panel
      id="approval-queue"
      title="待审批队列"
      description="只保留与发送前审批相关的任务状态，重点盯住 pending_review。"
      actions={
        <div className="queue-toolbar">
          <button className="button button-secondary" disabled={pendingReviewTasks.length === 0 || isSubmitting} onClick={onSelectAllPending} type="button">
            全选待审批
          </button>
          <button className="button button-primary" disabled={selectedTaskIds.length === 0 || isSubmitting} onClick={onApproveSelected} type="button">
            批准选中
          </button>
          <button className="button button-danger" disabled={selectedTaskIds.length === 0 || isSubmitting} onClick={onRejectSelected} type="button">
            拒绝选中
          </button>
        </div>
      }
    >
      <label className="field">
        <span>批量拒绝原因</span>
        <input
          aria-label="批量拒绝原因"
          className="input"
          onChange={(event) => onRejectReasonChange(event.target.value)}
          value={rejectReason}
        />
      </label>

      <div className="queue-list" aria-live="polite">
        {visibleTasks.map((task) => {
          const canSelect = task.status === "pending_review";
          const usedProfileItems = task.usedProfileItemIds
            .map((itemId) => profileItemsById.get(itemId))
            .filter((item): item is ProfileItem => Boolean(item));
          const modelProvenance = buildModelProvenance(task);
          const draftValue = draftEdits[task.id] ?? task.messageDraft;

          return (
            <article className="queue-card" key={task.id}>
              <div className="queue-card-header">
                <label className="checkbox-field queue-card-select">
                  <input
                    aria-label={`选择任务-${task.jobTitle}-${task.company}`}
                    checked={selectedTaskIds.includes(task.id)}
                    disabled={!canSelect || isSubmitting}
                    onChange={(event) => onSelectionChange(task.id, event.target.checked)}
                    type="checkbox"
                  />
                  选择
                </label>

                <div className="queue-card-title-group">
                  <strong>{task.jobTitle}</strong>
                  <span>{task.company}</span>
                </div>

                <StatusBadge label={task.status} tone={statusToneMap[task.status]} />
              </div>

              <dl className="meta-grid">
                <div>
                  <dt>分数</dt>
                  <dd>{task.score ?? "—"}</dd>
                </div>
                <div>
                  <dt>匹配理由</dt>
                  <dd>{task.matchReasons.join("；") || "无"}</dd>
                </div>
                <div>
                  <dt>匹配要求</dt>
                  <dd>{task.matchedRequirements.join("、") || "无"}</dd>
                </div>
                <div>
                  <dt>已用素材</dt>
                  <dd>{usedProfileItems.map((item) => item.content).join("；") || "未记录"}</dd>
                </div>
                <div>
                  <dt>模型来源</dt>
                  <dd>{modelProvenance}</dd>
                </div>
                <div>
                  <dt>成本 / 模板</dt>
                  <dd>
                    {task.estimatedCostCny} / v{task.templateVersion}
                    {task.refinementFallback ? " / 回退" : ""}
                  </dd>
                </div>
              </dl>

              <label className="field">
                <span>审批话术</span>
                <textarea
                  aria-label={`审批话术-${task.id}`}
                  className="textarea textarea-lg"
                  onChange={(event) => onDraftChange(task.id, event.target.value)}
                  value={draftValue}
                />
              </label>

              {onSaveDraft ? (
                <div className="queue-card-footer">
                  <button
                    className="button button-secondary"
                    disabled={isSubmitting || savingTaskIds.includes(task.id)}
                    onClick={() => onSaveDraft(task.id)}
                    type="button"
                  >
                    保存话术
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}

        {visibleTasks.length === 0 ? <p className="empty-state">当前没有待审批或发送相关任务。</p> : null}
      </div>
    </Panel>
  );
}

const statusToneMap: Record<GreetingTaskStatus, "default" | "teal" | "amber" | "danger"> = {
  collected: "default",
  filtered: "default",
  scored: "default",
  generated: "default",
  pending_review: "amber",
  approved: "teal",
  sending: "teal",
  sent: "teal",
  rejected: "danger",
  failed: "danger",
  paused: "amber",
  quota_blocked: "amber"
};

function buildModelProvenance(task: GreetingTask): string {
  return [
    `score ${task.scoringProvider || task.modelProvider || "local"}:${task.scoringModel || task.modelName || "template"}`,
    `final ${task.modelProvider || "local"}:${task.modelName || "template"}`,
    `refine ${task.refinementProvider || "local"}:${task.refinementModel || "template"}`
  ].join(" / ");
}
