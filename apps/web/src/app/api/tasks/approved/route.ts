import { NextResponse } from "next/server";
import { z } from "zod";

import { getDomainStore, getShanghaiDateKey } from "@/lib/domain-store";
import { parseJsonBody, withApiErrorHandling } from "@/lib/http";

export async function GET() {
  return withApiErrorHandling(async () => {
    const store = getDomainStore();
    const date = getShanghaiDateKey();
    const [allTasks, usage, config] = await Promise.all([
      store.getTasks(),
      store.getDailyUsage(date),
      store.getConfig()
    ]);
    const tasks = allTasks.filter((task) => task.status === "approved");
    const now = Date.now();
    const reserved = allTasks.filter(
      (task) =>
        task.status === "sending" &&
        new Date(
          task.sendLeaseExpiresAt ??
            new Date(new Date(task.updatedAt).getTime() + 2 * 60_000).toISOString()
        ).getTime() > now &&
        (task.quotaReservationDate ?? getShanghaiDateKey(new Date(task.updatedAt))) === date
    ).length;

    const used = usage.confirmedSends;
    const limit = config.dailyLimit;
    const remaining = Math.max(limit - used - reserved, 0);
    const blocked = remaining === 0;

    return NextResponse.json({
      tasks: blocked ? [] : tasks.slice(0, remaining),
      approvedCount: tasks.length,
      quota: {
        date,
        used,
        limit,
        reserved,
        blocked,
        usage,
        config,
        remaining
      }
    });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await parseJsonBody(request, z.object({}).strict());
    return NextResponse.json(await getDomainStore().claimApprovedTasksWithinQuota(getShanghaiDateKey()));
  });
}
