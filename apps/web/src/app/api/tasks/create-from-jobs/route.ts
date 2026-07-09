import { NextResponse } from "next/server";
import { z } from "zod";
import {
  evaluateJob,
  type GreetingTaskStatus
} from "@boss-agent/shared";

import { getDomainStore } from "@/lib/domain-store";
import { parseJsonBody, withApiErrorHandling } from "@/lib/http";

const NON_TERMINAL_TASK_STATUSES = new Set<GreetingTaskStatus>([
  "collected",
  "filtered",
  "scored",
  "generated",
  "pending_review",
  "approved",
  "sending",
  "paused",
  "quota_blocked"
]);

const createFromJobsRequestSchema = z
  .object({
    jobIds: z.array(z.string()).optional()
  })
  .strict();

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const body = await parseJsonBody(request, createFromJobsRequestSchema);
    const store = getDomainStore();
    const [config, jobs, tasks, preferenceState] = await Promise.all([
      store.getConfig(),
      store.getJobs(),
      store.getTasks(),
      store.getPreferenceState()
    ]);

    const requestedIds = body.jobIds ? unique(body.jobIds) : jobs.map((job) => job.id);
    const counts = {
      processed: 0,
      hardRejected: 0,
      pendingReview: 0,
      approved: 0,
      skipped: 0,
      failed: 0
    };

    for (const jobId of requestedIds) {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) {
        counts.failed += 1;
        continue;
      }

      if (hasNonTerminalTask(tasks, job.id)) {
        counts.skipped += 1;
        continue;
      }

      counts.processed += 1;

      try {
        const status = config.filteringEnabled ? "pending_review" : "approved";
        if (config.filteringEnabled) {
          const hardFilter = evaluateJob(job, config, preferenceState.rules);
          if (!hardFilter.accepted) {
            counts.hardRejected += 1;
            continue;
          }
        }

        const now = new Date().toISOString();
        const task = await store.createTaskIfNoActiveJobTask({
          id: globalThis.crypto.randomUUID(),
          jobId: job.id,
          jobTitle: job.title,
          company: job.company,
          detailUrl: job.detailUrl ?? "",
          messageDraft: "",
          status,
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

        if (!task) {
          counts.skipped += 1;
          continue;
        }

        if (status === "approved") counts.approved += 1;
        else counts.pendingReview += 1;
      } catch {
        counts.failed += 1;
      }
    }

    return NextResponse.json({ counts });
  });
}

function hasNonTerminalTask(
  tasks: Array<{ jobId: string; status: GreetingTaskStatus }>,
  jobId: string
): boolean {
  return tasks.some(
    (task) => task.jobId === jobId && NON_TERMINAL_TASK_STATUSES.has(task.status)
  );
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
