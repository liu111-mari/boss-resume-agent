import { NextResponse } from "next/server";
import { z } from "zod";

import { getDomainStore } from "@/lib/domain-store";
import { parseJsonBody, withApiErrorHandling } from "@/lib/http";

const requestSchema = z.object({
  ruleId: z.string().min(1),
  version: z.number().int().positive()
}).strict();

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { ruleId, version } = await parseJsonBody(request, requestSchema);
    const rule = await getDomainStore().restorePreferenceRuleVersion(ruleId, version);
    return NextResponse.json({ rule });
  });
}
