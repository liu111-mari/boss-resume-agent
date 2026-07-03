"use client";

import React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GreetingTask, Profile } from "@boss-agent/shared";

import ApprovalQueue from "@/components/approval-queue";
import ApprovalSendControl from "@/components/approval-send-control";
import PageFeedback from "@/components/page-feedback";
import { PageHeader } from "@/components/ui";
import { loadApprovalsPageData, loadApprovalTasksPageData } from "@/lib/client-api";
import { checkExtensionBridge, runApprovedTasksViaExtension } from "@/lib/extension-bridge";
import { isApprovableTask, reconcileSelectedTaskIds } from "@/lib/workbench-helpers";

const EMPTY_PROFILE: Profile = {
  school: "",
  major: "",
  graduation: "",
  direction: "",
  items: []
};

export default function ApprovalsPage() {
  const [tasks, setTasks] = useState<GreetingTask[]>([]);
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [isCheckingExtension, setIsCheckingExtension] = useState(true);
  const [isRunningApproved, setIsRunningApproved] = useState(false);

  const applyData = useCallback((data: Awaited<ReturnType<typeof loadApprovalsPageData>>) => {
    setProfile(data.profile);
    setTasks(data.tasks);
    setSelectedTaskIds((current) => reconcileSelectedTaskIds(data.tasks, current));
    setDraftEdits((current) =>
      Object.fromEntries(
        data.tasks.map((task) => [task.id, current[task.id] ?? task.messageDraft])
      )
    );
  }, []);

  const loadInitialData = useCallback(async () => {
    try {
      applyData(await loadApprovalsPageData());
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "审批队列加载失败");
    }
  }, [applyData]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    void checkExtensionBridge()
      .then(() => setExtensionConnected(true))
      .catch(() => setExtensionConnected(false))
      .finally(() => setIsCheckingExtension(false));
  }, []);

  const refreshTasks = useCallback(async () => {
    try {
      const nextTasks = await loadApprovalTasksPageData();
      setTasks(nextTasks);
      setSelectedTaskIds((current) => reconcileSelectedTaskIds(nextTasks, current));
      setDraftEdits((current) =>
        Object.fromEntries(nextTasks.map((task) => [task.id, current[task.id] ?? task.messageDraft]))
      );
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "审批队列加载失败");
    }
  }, []);

  const profileItemsById = useMemo(
    () => new Map(profile.items.map((item) => [item.id, item])),
    [profile.items]
  );

  const handleRunApproved = useCallback(async () => {
    setIsRunningApproved(true);
    setError("");
    setStatus("");
    try {
      const result = await runApprovedTasksViaExtension();
      if (!result.ok) throw new Error(result.message);
      setStatus(result.message);
      await refreshTasks();
    } catch (cause) {
      setExtensionConnected(false);
      setError(cause instanceof Error ? cause.message : "自动发送启动失败");
    } finally {
      setIsRunningApproved(false);
    }
  }, [refreshTasks]);

  const pendingCount = tasks.filter((task) => task.status === "pending_review").length;
  const pausedCount = tasks.filter((task) => task.status === "paused").length;
  const approvedCount = tasks.filter((task) => task.status === "approved").length;

  return (
    <>
      <PageHeader description="发送前必须人工确认；审批动作继续受现有安全逻辑约束。" title="审批队列" />
      <PageFeedback error={error} status={status} />
      <ApprovalSendControl
        approvedCount={approvedCount}
        checking={isCheckingExtension}
        connected={extensionConnected}
        onRun={() => void handleRunApproved()}
        pausedCount={pausedCount}
        pendingCount={pendingCount}
        running={isRunningApproved}
      />
      <ApprovalQueue
        draftEdits={draftEdits}
        onDraftChange={(taskId, value) => setDraftEdits((current) => ({ ...current, [taskId]: value }))}
        onError={setError}
        onOperationalRefresh={refreshTasks}
        onRejectReasonChange={setRejectReason}
        onSelectionChange={(taskId, checked) =>
          setSelectedTaskIds((current) =>
            checked ? Array.from(new Set([...current, taskId])) : current.filter((id) => id !== taskId)
          )
        }
        onSelectionReset={() => {
          setSelectedTaskIds([]);
          setRejectReason("");
        }}
        onSelectAllApprovable={() =>
          setSelectedTaskIds(tasks.filter(isApprovableTask).map((task) => task.id))
        }
        onSelectAllPreference={() =>
          setSelectedTaskIds(tasks.filter((task) =>
            ["pending_review", "approved", "paused", "quota_blocked"].includes(task.status)
          ).map((task) => task.id))
        }
        onStatus={setStatus}
        onTaskSaved={(savedTask) => {
          setTasks((current) => current.map((task) => task.id === savedTask.id ? savedTask : task));
          setDraftEdits((current) => ({ ...current, [savedTask.id]: savedTask.messageDraft }));
        }}
        profileItemsById={profileItemsById}
        rejectReason={rejectReason}
        selectedTaskIds={selectedTaskIds}
        tasks={tasks}
      />
    </>
  );
}
