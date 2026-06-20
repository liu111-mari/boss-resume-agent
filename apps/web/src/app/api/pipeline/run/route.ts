import { NextResponse } from "next/server";
import { z } from "zod";

import { parseJsonBody, withApiErrorHandling } from "@/lib/http";
import { runGreetingPipeline } from "@/lib/greeting-pipeline";

const runPipelineRequestSchema = z
  .object({
    jobIds: z.array(z.string()).optional()
  })
  .strict();

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const body = await parseJsonBody(request, runPipelineRequestSchema);
    const counts = await runGreetingPipeline(body.jobIds);
    return NextResponse.json({ counts });
  });
}
