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

    const isManualSelection = body.jobIds !== undefined;
    const requestedIds = body.jobIds ? unique(body.jobIds) : jobs.map((job) => job.id);
    const counts = {
      requested: requestedIds.length,
      processed: 0,
      hardRejected: 0,
      pendingReview: 0,
      approved: 0,
      skipped: 0,
      skippedActive: 0,
      notFound: 0,
      failed: 0
    };
    const issues: Array<{
      jobId: string;
      reason: "active_task_exists" | "job_not_found" | "task_creation_failed";
    }> = [];

    for (const jobId of requestedIds) {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) {
        counts.notFound += 1;
        issues.push({ jobId, reason: "job_not_found" });
        continue;
      }

      if (hasNonTerminalTask(tasks, job.id)) {
        counts.skipped += 1;
        counts.skippedActive += 1;
        issues.push({ jobId, reason: "active_task_exists" });
        continue;
      }

      counts.processed += 1;

      try {
        const status = isManualSelection
          ? "pending_review"
          : config.filteringEnabled
            ? "pending_review"
            : "approved";
        if (!isManualSelection && config.filteringEnabled) {
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
          counts.skippedActive += 1;
          issues.push({ jobId, reason: "active_task_exists" });
          continue;
        }

        if (status === "approved") counts.approved += 1;
        else counts.pendingReview += 1;
      } catch {
        counts.failed += 1;
        issues.push({ jobId, reason: "task_creation_failed" });
      }
    }

    return NextResponse.json({ counts, issues });
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
