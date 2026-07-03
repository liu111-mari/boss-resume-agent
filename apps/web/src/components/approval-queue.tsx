import React from "react";
import type {
  GreetingTask,
  GreetingTaskStatus,
  JobCard,
  PreferenceFocusField,
  ProfileItem
} from "@boss-agent/shared";

import { Panel, StatusBadge } from "@/components/ui";
import JobQuickView from "@/components/job-quick-view";
import {
  approveTasks,
  rejectTasks,
  submitJobFeedback,
  undoJobFeedback,
  updateTaskDraft,
  type JobFeedbackAction
} from "@/lib/client-api";
import { isApprovableTask, reconcileSelectedTaskIds } from "@/lib/workbench-helpers";

type ApprovalQueueProps = {
  tasks: GreetingTask[];
  jobsById?: Map<string, JobCard>;
  positiveTerms?: string[];
  negativeTerms?: string[];
  profileItemsById: Map<string, ProfileItem>;
  selectedTaskIds: string[];
  draftEdits?: Record<string, string>;
  rejectReason: string;
  onDraftChange: (taskId: string, value: string) => void;
  onTaskSaved: (task: GreetingTask) => void;
  onOperationalRefresh: () => Promise<void>;
  onRejectReasonChange: (value: string) => void;
  onSelectionChange: (taskId: string, checked: boolean) => void;
  onSelectAllApprovable: () => void;
  onSelectAllPreference?: () => void;
  onSelectionReset?: () => void;
  onStatus?: (message: string) => void;
  onError?: (message: string) => void;
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
  jobsById = new Map(),
  positiveTerms = [],
  negativeTerms = [],
  profileItemsById,
  selectedTaskIds,
  draftEdits = {},
  rejectReason,
  onDraftChange,
  onTaskSaved,
  onOperationalRefresh,
  onRejectReasonChange,
  onSelectionChange,
  onSelectAllApprovable,
  onSelectAllPreference,
  onSelectionReset,
  onStatus,
  onError
}: ApprovalQueueProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [savingTaskIds, setSavingTaskIds] = React.useState<string[]>([]);
  const [focusFields, setFocusFields] = React.useState<PreferenceFocusField[]>([
    "title",
    "industry",
    "jdResponsibilities"
  ]);
  const [preferenceNote, setPreferenceNote] = React.useState("");
  const [lastFeedbackIds, setLastFeedbackIds] = React.useState<string[]>([]);
  const visibleTasks = tasks.filter((task) => visibleStatuses.has(task.status));
  const approvableTasks = visibleTasks.filter(isApprovableTask);
  const actionableSelectedTaskIds = reconcileSelectedTaskIds(tasks, selectedTaskIds);
  const preferenceSelectableTasks = visibleTasks.filter((task) => task.status !== "sending");
  const selectedPreferenceTasks = preferenceSelectableTasks.filter((task) =>
    selectedTaskIds.includes(task.id)
  );

  const handleSaveDraft = React.useCallback(
    async (taskId: string) => {
      const task = tasks.find((item) => item.id === taskId);
      if (!task) return;

      setSavingTaskIds((current) => (current.includes(taskId) ? current : [...current, taskId]));
      try {
        const savedTask = await updateTaskDraft(
          task.id,
          draftEdits[taskId] ?? task.messageDraft,
          task.updatedAt
        );
        onTaskSaved(savedTask.task);
        onStatus?.("审批话术已保存。");
        onError?.("");
      } catch (error) {
        onError?.(getErrorMessage(error));
      } finally {
        setSavingTaskIds((current) => current.filter((item) => item !== taskId));
      }
    },
    [draftEdits, onError, onStatus, onTaskSaved, tasks]
  );

  const handleApproveSelected = React.useCallback(async () => {
    if (actionableSelectedTaskIds.length === 0) return;

    setIsSubmitting(true);
    try {
      await approveTasks(actionableSelectedTaskIds);
      onSelectionReset?.();
      onStatus?.("选中任务已批准。");
      onError?.("");
      await onOperationalRefresh();
    } catch (error) {
      onError?.(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }, [actionableSelectedTaskIds, onError, onOperationalRefresh, onSelectionReset, onStatus]);

  const handleRejectSelected = React.useCallback(async () => {
    if (actionableSelectedTaskIds.length === 0) return;

    setIsSubmitting(true);
    try {
      await rejectTasks(actionableSelectedTaskIds, rejectReason.trim() || undefined);
      onSelectionReset?.();
      onStatus?.("选中任务已拒绝。");
      onError?.("");
      await onOperationalRefresh();
    } catch (error) {
      onError?.(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }, [actionableSelectedTaskIds, onError, onOperationalRefresh, onSelectionReset, onStatus, rejectReason]);

  const handlePreferenceAction = React.useCallback(async (
    targetTasks: GreetingTask[],
    action: JobFeedbackAction
  ) => {
    const jobIds = Array.from(new Set(targetTasks.map((task) => task.jobId)));
    if (jobIds.length === 0 || isSubmitting) return;
    if (
      action !== "favorite" &&
      typeof window !== "undefined" &&
      !window.confirm(action === "negative_remove" ? "确认将岗位标记为不喜欢并移除？" : "确认移除岗位且不用于AI学习？")
    ) return;

    setIsSubmitting(true);
    try {
      const result = await submitJobFeedback({
        jobIds,
        action,
        focusFields,
        note: preferenceNote
      });
      setLastFeedbackIds(result.feedback.map((item) => item.id));
      onSelectionReset?.();
      onStatus?.(
        action === "favorite"
          ? `已记录 ${result.feedback.length} 条重点关注反馈。`
          : `已移除 ${result.removedJobIds.length} 个岗位，取消 ${result.canceledTaskIds.length} 个未发送任务${result.blockedJobIds.length ? `，${result.blockedJobIds.length} 个发送中岗位未处理` : ""}。`
      );
      onError?.("");
      await onOperationalRefresh();
    } catch (error) {
      onError?.(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }, [focusFields, isSubmitting, onError, onOperationalRefresh, onSelectionReset, onStatus, preferenceNote]);

  const handleUndoPreference = React.useCallback(async () => {
    if (lastFeedbackIds.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      for (const feedbackId of lastFeedbackIds) await undoJobFeedback(feedbackId);
      setLastFeedbackIds([]);
      onStatus?.("已撤销上次偏好反馈并恢复被移除岗位；旧审批任务不会自动恢复。");
      onError?.("");
      await onOperationalRefresh();
    } catch (error) {
      onError?.(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, lastFeedbackIds, onError, onOperationalRefresh, onStatus]);

  return (
    <Panel
      id="approval-queue"
      title="待审批队列"
      description="待审批任务可直接批准；暂停任务处理完原因后可重新批准。"
      actions={
        <div className="queue-toolbar">
          <button className="button button-secondary" disabled={approvableTasks.length === 0 || isSubmitting} onClick={onSelectAllApprovable} type="button">
            全选可审批
          </button>
          <button className="button button-primary" disabled={actionableSelectedTaskIds.length === 0 || isSubmitting} onClick={handleApproveSelected} type="button">
            批准选中
          </button>
          <button className="button button-danger" disabled={actionableSelectedTaskIds.length === 0 || isSubmitting} onClick={handleRejectSelected} type="button">
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

      <div className="preference-toolbar">
        <strong>偏好处理选中任务（{selectedPreferenceTasks.length}）</strong>
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
            onChange={(event) => setPreferenceNote(event.target.value)}
            placeholder="例如：岗位偏销售，缺少长期技能积累"
            value={preferenceNote}
          />
        </label>
        <div className="panel-actions-row">
          <button className="button button-secondary" disabled={isSubmitting || preferenceSelectableTasks.length === 0 || !onSelectAllPreference} onClick={onSelectAllPreference} type="button">全选可处理</button>
          <button className="button button-secondary" disabled={isSubmitting || selectedPreferenceTasks.length === 0} onClick={() => void handlePreferenceAction(selectedPreferenceTasks, "favorite")} type="button">重点关注</button>
          <button className="button button-danger" disabled={isSubmitting || selectedPreferenceTasks.length === 0} onClick={() => void handlePreferenceAction(selectedPreferenceTasks, "negative_remove")} type="button">不喜欢并移除</button>
          <button className="button button-danger-ghost" disabled={isSubmitting || selectedPreferenceTasks.length === 0} onClick={() => void handlePreferenceAction(selectedPreferenceTasks, "remove")} type="button">普通移除</button>
          {lastFeedbackIds.length ? <button className="button button-ghost" disabled={isSubmitting} onClick={() => void handleUndoPreference()} type="button">撤销上次偏好反馈</button> : null}
        </div>
      </div>

      <div className="queue-list" aria-live="polite">
        {visibleTasks.map((task) => {
          const canSelect = task.status !== "sending";
          const usedProfileItems = task.usedProfileItemIds
            .map((itemId) => profileItemsById.get(itemId))
            .filter((item): item is ProfileItem => Boolean(item));
          const modelProvenance = buildModelProvenance(task);
          const draftValue = draftEdits[task.id] ?? task.messageDraft;
          const job = jobsById.get(task.jobId) ?? createFallbackJob(task);

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

                <div className="queue-card-title-group"><JobQuickView job={job} negativeTerms={negativeTerms} positiveTerms={positiveTerms} /></div>

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

              <div className="queue-card-footer">
                <button
                  className="button button-secondary"
                  disabled={isSubmitting || savingTaskIds.includes(task.id)}
                  onClick={() => handleSaveDraft(task.id)}
                  type="button"
                >
                  保存话术
                </button>
                <button className="button button-secondary" disabled={isSubmitting} onClick={() => void handlePreferenceAction([task], "favorite")} type="button">重点关注</button>
                <button className="button button-danger" disabled={isSubmitting || task.status === "sending"} onClick={() => void handlePreferenceAction([task], "negative_remove")} type="button">不喜欢并移除</button>
                <button className="button button-danger-ghost" disabled={isSubmitting || task.status === "sending"} onClick={() => void handlePreferenceAction([task], "remove")} type="button">普通移除</button>
              </div>
            </article>
          );
        })}

        {visibleTasks.length === 0 ? <p className="empty-state">当前没有待审批或发送相关任务。</p> : null}
      </div>
    </Panel>
  );
}

const focusFieldOptions: Array<{ value: PreferenceFocusField; label: string }> = [
  { value: "title", label: "岗位名称" },
  { value: "industry", label: "行业" },
  { value: "jdResponsibilities", label: "JD工作内容" },
  { value: "jdRequirements", label: "JD任职要求" },
  { value: "other", label: "其他" }
];

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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}

function createFallbackJob(task: GreetingTask): JobCard {
  return {
    id: task.jobId,
    title: task.jobTitle,
    company: task.company,
    city: "",
    salary: "",
    hrName: "",
    hrActiveText: "",
    detailUrl: task.detailUrl,
    sourcePage: "boss",
    jdText: "",
    jdSource: "list",
    experience: "",
    education: "",
    industry: "",
    rawText: "",
    direction: "其他",
    collectedAt: task.createdAt
  };
}
