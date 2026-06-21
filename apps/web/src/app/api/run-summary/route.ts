import { NextResponse } from "next/server";

import { getDomainStore, getShanghaiDateKey } from "@/lib/domain-store";
import { withApiErrorHandling } from "@/lib/http";

export async function GET() {
  return withApiErrorHandling(async () => {
    const store = getDomainStore();
    const date = getShanghaiDateKey();
    const [config, usage, tasks, logs] = await Promise.all([
      store.getConfig(),
      store.getDailyUsage(date),
      store.getTasks(),
      store.getRunLogs()
    ]);

    const taskStatusCounts = tasks.reduce<Record<string, number>>((counts, task) => {
      counts[task.status] = (counts[task.status] ?? 0) + 1;
      return counts;
    }, {});

    const recentLogs = logs
      .slice()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 20);
    const pausedReason =
      tasks
        .filter((task) => task.status === "paused" && task.failureReason)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.failureReason ??
      usage.pausedReason;

    return NextResponse.json({
      date,
      config,
      usage,
      pausedReason,
      taskStatusCounts,
      recentLogs
    });
  });
}
