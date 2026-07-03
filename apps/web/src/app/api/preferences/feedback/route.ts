import { NextResponse } from "next/server";
import { z } from "zod";

import { preferenceFocusFieldSchema } from "@boss-agent/shared";
import { getDomainStore } from "@/lib/domain-store";
import { parseJsonBody, withApiErrorHandling } from "@/lib/http";

const requestSchema = z.object({
  jobIds: z.array(z.string()).min(1),
  action: z.enum(["favorite", "negative_remove", "remove"]),
  focusFields: z.array(preferenceFocusFieldSchema).default([]),
  note: z.string().max(1000).default("")
}).strict();

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const body = await parseJsonBody(request, requestSchema);
    const store = getDomainStore();
    if (body.action === "remove") {
      const result = await store.removeJobs(body.jobIds);
      return NextResponse.json({ ...result, feedback: [] });
    }
    const result = await store.recordJobFeedback({
      jobIds: body.jobIds,
      label: body.action === "favorite" ? "positive" : "negative",
      remove: body.action === "negative_remove",
      focusFields: body.focusFields,
      note: body.note
    });
    return NextResponse.json(result);
  });
}
