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
        confirmationEvidence: z.string().trim().min(1).optional()
      })
    );

    const store = getDomainStore();
    if (body.status === "sending") {
      const task = await store.refreshTaskSendReservation(body.taskId);
      return NextResponse.json({ task });
    }
    if (body.status === "sent") {
      if (!body.confirmationEvidence) {
        return NextResponse.json(
          {
            error: "invalid_request",
            issues: [{ code: "custom", message: "confirmationEvidence is required for sent", path: ["confirmationEvidence"] }]
          },
          { status: 400 }
        );
      }
      const task = await store.confirmTaskSent(body.taskId, body.confirmationEvidence);
      return NextResponse.json({ task });
    }

    const metadata = {
      ...(body.failureReason === undefined ? {} : { failureReason: body.failureReason }),
      ...(body.confirmationEvidence === undefined ? {} : { confirmationEvidence: body.confirmationEvidence })
    };
    const task = await store.transitionTask(body.taskId, body.status, metadata);
    return NextResponse.json({ task });
  });
}
