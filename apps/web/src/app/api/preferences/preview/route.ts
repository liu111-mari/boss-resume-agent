import { NextResponse } from "next/server";
import { z } from "zod";

import { preferenceRuleCandidateSchema, preferenceRuleSchema, previewPreferenceRule } from "@boss-agent/shared";
import { getDomainStore } from "@/lib/domain-store";
import { parseJsonBody, withApiErrorHandling } from "@/lib/http";

const requestSchema = z.object({ candidate: preferenceRuleCandidateSchema }).strict();

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const body = await parseJsonBody(request, requestSchema);
    const store = getDomainStore();
    const [jobs, state] = await Promise.all([store.getJobs(), store.getPreferenceState()]);
    const now = new Date().toISOString();
    const candidate = preferenceRuleSchema.parse({
      ...body.candidate,
      id: `preview:${body.candidate.tempId}`,
      provenance: "ai_accepted",
      active: true,
      locked: false,
      version: 1,
      createdAt: now,
      updatedAt: now
    });
    return NextResponse.json(previewPreferenceRule(jobs, state.rules, candidate));
  });
}
