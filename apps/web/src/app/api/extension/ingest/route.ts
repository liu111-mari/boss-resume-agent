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
    const store = getDomainStore();
    const jobs = await store.upsertJobs(body.jobs);
    const config = await store.getConfig();
    let approvedTaskCount = 0;
    if (!config.filteringEnabled) {
      for (const job of jobs) {
        const now = new Date().toISOString();
        const task = await store.createTaskIfNoActiveJobTask({
          id: globalThis.crypto.randomUUID(),
          jobId: job.id,
          jobTitle: job.title,
          company: job.company,
          detailUrl: job.detailUrl ?? "",
          messageDraft: "",
          status: "approved",
          score: undefined,
          matchReasons: [],
          matchedRequirements: [],
          missingRequirements: [],
          usedProfileItemIds: [],
          modelProvider: "local",
          modelName: "template",
          scoringProvider: "",
          scoringModel: "",
          refinementProvider: "",
          refinementModel: "",
          refinementFallback: false,
          templateVersion: 1,
          estimatedCostCny: 0,
          failureReason: "",
          createdAt: now,
          updatedAt: now
        });
        if (task) approvedTaskCount += 1;
      }
    }
    return NextResponse.json({ ok: true, jobs, acceptedCount: body.jobs.length, approvedTaskCount });
  });
}
