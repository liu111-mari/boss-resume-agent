import { NextResponse } from "next/server";
import { z } from "zod";

import { getDomainStore } from "@/lib/domain-store";
import { parseJsonBody, withApiErrorHandling } from "@/lib/http";

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const input = await parseJsonBody(request, z.unknown());

    if (
      typeof input === "object" &&
      input !== null &&
      "conversations" in input
    ) {
      return NextResponse.json(
        {
          error: "conversations_not_supported"
        },
        { status: 400 }
      );
    }

    const body = z
      .object({
        jobs: z.array(z.unknown()).min(1)
      })
      .strict()
      .parse(input);
    const jobs = await getDomainStore().upsertJobs(body.jobs);
    return NextResponse.json({ ok: true, jobs, acceptedCount: body.jobs.length });
  });
}
