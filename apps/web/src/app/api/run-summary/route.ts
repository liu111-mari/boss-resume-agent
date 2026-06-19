import { NextResponse } from "next/server";

import { getDomainStore } from "@/lib/domain-store";
import { withApiErrorHandling } from "@/lib/http";

export async function GET() {
  return withApiErrorHandling(async () => {
    const store = getDomainStore();
    const date = getLocalDateKey();
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

    return NextResponse.json({
      date,
      config,
      usage,
      taskStatusCounts,
      recentLogs
    });
  });
}

function getLocalDateKey(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
