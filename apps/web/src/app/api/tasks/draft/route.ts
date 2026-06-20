import { NextResponse } from "next/server";
import { z } from "zod";

import { getDomainStore } from "@/lib/domain-store";
import { parseJsonBody, withApiErrorHandling } from "@/lib/http";

const updateTaskDraftRequestSchema = z
  .object({
    taskId: z.string(),
    messageDraft: z.string().min(1),
    expectedUpdatedAt: z.string()
  })
  .strict();

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const body = await parseJsonBody(request, updateTaskDraftRequestSchema);
    const task = await getDomainStore().updateTaskDraft(
      body.taskId,
      body.messageDraft,
      body.expectedUpdatedAt
    );
    return NextResponse.json({ task });
  });
}
