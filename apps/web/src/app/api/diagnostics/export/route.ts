import { NextResponse } from "next/server";

import { redactDiagnosticsData } from "@/lib/diagnostics";
import { getDomainStore } from "@/lib/domain-store";
import { withApiErrorHandling } from "@/lib/http";

export async function GET() {
  return withApiErrorHandling(async () => {
    const store = getDomainStore();
    const [config, tasks, logs, dailyUsage] = await Promise.all([
      store.getConfig(),
      store.getTasks(),
      store.getRunLogs(),
      store.getDailyUsageHistory()
    ]);

    const payload = redactDiagnosticsData({
      config,
      tasks,
      logs,
      dailyUsage
    });

    return NextResponse.json(payload, {
      headers: {
        "content-disposition": `attachment; filename="boss-agent-diagnostics-${getTimestamp()}.json"`
      }
    });
  });
}

function getTimestamp(now = new Date()): string {
  return now.toISOString().replace(/[:.]/g, "-");
}
