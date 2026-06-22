"use client";

import React from "react";
import { useCallback, useEffect, useState } from "react";

import PageFeedback from "@/components/page-feedback";
import RunStatus from "@/components/run-status";
import { PageHeader } from "@/components/ui";
import { loadRunsPageData, type WorkbenchRunSummary } from "@/lib/client-api";

export default function RunsPage() {
  const [runSummary, setRunSummary] = useState<WorkbenchRunSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setRunSummary(await loadRunsPageData());
      setError("");
      setStatus("运行数据已更新。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "运行记录加载失败");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return (
    <>
      <PageHeader description="查看发送额度、任务状态和最近运行日志。" title="运行记录" />
      <PageFeedback error={error} status={status} />
      <RunStatus
        isRefreshing={refreshing}
        onRefresh={() => void refresh()}
        runSummary={runSummary}
        serviceHealthy={!error && Boolean(runSummary)}
      />
    </>
  );
}
