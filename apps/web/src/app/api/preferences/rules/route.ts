import { NextResponse } from "next/server";
import { z } from "zod";

import { preferenceRuleSchema } from "@boss-agent/shared";
import { getDomainStore } from "@/lib/domain-store";
import { parseJsonBody, withApiErrorHandling } from "@/lib/http";

const requestSchema = z.object({ rules: z.array(preferenceRuleSchema) }).strict();

export async function PUT(request: Request) {
  return withApiErrorHandling(async () => {
    const body = await parseJsonBody(request, requestSchema);
    const store = getDomainStore();
    const current = await store.getPreferenceState();
    const now = new Date().toISOString();
    const rules = body.rules.map((rule) => {
      const existing = current.rules.find((item) => item.id === rule.id);
      const changed = existing && JSON.stringify({ ...existing, updatedAt: "" }) !== JSON.stringify({ ...rule, updatedAt: "" });
      return preferenceRuleSchema.parse({
        ...rule,
        provenance: changed ? "manual" : rule.provenance,
        version: changed ? existing.version + 1 : rule.version,
        createdAt: existing?.createdAt ?? rule.createdAt,
        updatedAt: changed ? now : rule.updatedAt
      });
    });
    return NextResponse.json({ rules: await store.savePreferenceRules(rules) });
  });
}
