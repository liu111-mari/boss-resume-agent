import { NextResponse } from "next/server";
import { z } from "zod";

import { getDomainStore } from "@/lib/domain-store";
import { parseJsonBody, withApiErrorHandling } from "@/lib/http";

const requestSchema = z.object({ feedbackId: z.string().min(1) }).strict();

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const body = await parseJsonBody(request, requestSchema);
    return NextResponse.json(await getDomainStore().undoPreferenceFeedback(body.feedbackId));
  });
}
