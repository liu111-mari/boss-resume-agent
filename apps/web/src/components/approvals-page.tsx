"use client";

import React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GreetingTask, Profile } from "@boss-agent/shared";

import ApprovalQueue from "@/components/approval-queue";
import PageFeedback from "@/components/page-feedback";
import { PageHeader } from "@/components/ui";
import { loadApprovalsPageData, loadApprovalTasksPageData } from "@/lib/client-api";
import { reconcileSelectedTaskIds } from "@/lib/workbench-helpers";

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

  return (
    <>
      <PageHeader description="发送前必须人工确认；审批动作继续受现有安全逻辑约束。" title="审批队列" />
      <PageFeedback error={error} status={status} />
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
        onSelectAllPending={() =>
          setSelectedTaskIds(tasks.filter((task) => task.status === "pending_review").map((task) => task.id))
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
