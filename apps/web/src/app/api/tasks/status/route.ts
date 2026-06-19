import { greetingTaskSchema } from "@boss-agent/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDomainStore } from "@/lib/domain-store";
import { parseJsonBody, withApiErrorHandling } from "@/lib/http";

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const body = await parseJsonBody(
      request,
      z.object({
        taskId: z.string(),
        status: greetingTaskSchema.shape.status,
        failureReason: z.string().optional(),
        confirmationEvidence: z.string().optional()
      })
    );

    const metadata = body.failureReason === undefined ? {} : { failureReason: body.failureReason };
    const task = await getDomainStore().transitionTask(body.taskId, body.status, metadata);
    return NextResponse.json({ task });
  });
}
