import { NextResponse } from "next/server";
import { z } from "zod";

import { preferenceSuggestionBatchSchema } from "@boss-agent/shared";
import { getDomainStore } from "@/lib/domain-store";
import { parseJsonBody, withApiErrorHandling } from "@/lib/http";
import { createConfiguredPreferenceOptimizer } from "@/lib/preference-optimizer";

const requestSchema = z.object({
  correction: z.string().max(2000).default(""),
  previousBatchId: z.string().nullable().optional()
}).strict();

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const body = await parseJsonBody(request, requestSchema);
    const store = getDomainStore();
    const [state, profile] = await Promise.all([store.getPreferenceState(), store.getProfile()]);
    const previous = body.previousBatchId
      ? state.suggestions.find((item) => item.id === body.previousBatchId)
      : undefined;
    if (body.previousBatchId && !previous) throw new Error("preference_suggestion_not_found");
    const previousIds = new Set(previous?.feedbackIds ?? []);
    const feedback = state.feedback.filter((item) =>
      item.active && (previousIds.has(item.id) || item.consumedBySuggestionIds.length === 0)
    ).slice(-30);
    if (feedback.length === 0) throw new Error("没有可分析的岗位反馈");

    const result = await createConfiguredPreferenceOptimizer().analyze({
      feedback,
      currentRules: state.rules,
      profile,
      correction: body.correction,
      previousCandidates: previous?.candidates ?? []
    });
    const now = new Date().toISOString();
    const batch = preferenceSuggestionBatchSchema.parse({
      id: globalThis.crypto.randomUUID(),
      feedbackIds: feedback.map((item) => item.id),
      currentRuleIds: state.rules.filter((rule) => rule.active).map((rule) => rule.id),
      previousBatchId: previous?.id,
      correction: body.correction,
      candidates: result.candidates,
      status: "draft",
      provider: result.provider,
      model: result.model,
      estimatedCostCny: result.estimatedCostCny,
      createdAt: now,
      updatedAt: now
    });
    if (previous) {
      await store.updateSuggestionBatch(previous.id, { status: "superseded", updatedAt: now });
    }
    await store.saveSuggestionBatch(batch);
    return NextResponse.json({ batch });
  });
}
