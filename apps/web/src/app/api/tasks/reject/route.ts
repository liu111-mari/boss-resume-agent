import { NextResponse } from "next/server";
import { z } from "zod";

import { getDomainStore } from "@/lib/domain-store";
import { parseJsonBody, withApiErrorHandling } from "@/lib/http";

const rejectTasksRequestSchema = z
  .object({
    taskIds: z.array(z.string()),
    reason: z.string().optional()
  })
  .strict();

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const body = await parseJsonBody(request, rejectTasksRequestSchema);
    const tasks = await getDomainStore().rejectTasks(body.taskIds, body.reason ?? "");
    return NextResponse.json({ tasks });
  });
}
