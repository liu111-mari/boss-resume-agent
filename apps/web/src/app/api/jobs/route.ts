import { jobCardSchema } from "@boss-agent/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDomainStore } from "@/lib/domain-store";
import { parseJsonBody, withApiErrorHandling } from "@/lib/http";

export async function GET() {
  return withApiErrorHandling(async () => {
    const jobs = await getDomainStore().getJobs();
    return NextResponse.json({ jobs });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const payload = await parseJsonBody(
      request,
      z.union([
        jobCardSchema,
        z.object({
          jobs: z.array(jobCardSchema)
        })
      ])
    );
    const jobs = await getDomainStore().upsertJobs("jobs" in payload ? payload.jobs : [payload]);
    return NextResponse.json({ jobs });
  });
}
