import { NextResponse } from "next/server";
import { z } from "zod";

import { getDomainStore } from "@/lib/domain-store";
import { parseJsonBody, withApiErrorHandling } from "@/lib/http";

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const body = await parseJsonBody(
      request,
      z.object({
        jobs: z.array(z.unknown()).optional(),
        conversations: z.array(z.unknown()).optional()
      })
    );

    if (body.conversations) {
      return NextResponse.json(
        {
          error: "conversations_not_supported"
        },
        { status: 400 }
      );
    }

    const jobs = body.jobs ? await getDomainStore().upsertJobs(body.jobs) : [];
    return NextResponse.json({ ok: true, jobs, acceptedCount: body.jobs?.length ?? 0 });
  });
}
