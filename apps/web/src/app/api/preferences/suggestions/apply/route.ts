import { NextResponse } from "next/server";
import { z } from "zod";

import { preferenceRuleCandidateSchema, preferenceRuleSchema } from "@boss-agent/shared";
import { getDomainStore } from "@/lib/domain-store";
import { parseJsonBody, withApiErrorHandling } from "@/lib/http";

const requestSchema = z.object({
  batchId: z.string().min(1),
  candidates: z.array(preferenceRuleCandidateSchema).min(1)
}).strict();

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const body = await parseJsonBody(request, requestSchema);
    const store = getDomainStore();
    const state = await store.getPreferenceState();
    const batch = state.suggestions.find((item) => item.id === body.batchId);
    if (!batch || batch.status !== "draft") throw new Error("preference_suggestion_not_applicable");
    const now = new Date().toISOString();
    const accepted = body.candidates.map((candidate) => preferenceRuleSchema.parse({
      ...candidate,
      id: globalThis.crypto.randomUUID(),
      provenance: "ai_accepted",
      active: true,
      locked: false,
      version: 1,
      createdAt: now,
      updatedAt: now
    }));
    const rules = await store.savePreferenceRules([...state.rules, ...accepted]);
    await store.updateSuggestionBatch(batch.id, { status: "accepted", updatedAt: now });
    return NextResponse.json({ rules, acceptedRuleIds: accepted.map((rule) => rule.id) });
  });
}
