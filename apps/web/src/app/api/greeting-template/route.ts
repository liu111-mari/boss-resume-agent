import { greetingTemplateSchema } from "@boss-agent/shared";
import { NextResponse } from "next/server";

import { getDomainStore } from "@/lib/domain-store";
import { parseJsonBody, withApiErrorHandling } from "@/lib/http";

export async function GET() {
  return withApiErrorHandling(async () => {
    const template = await getDomainStore().getTemplate();
    return NextResponse.json({ template });
  });
}

export async function PUT(request: Request) {
  return withApiErrorHandling(async () => {
    const template = await getDomainStore().saveTemplate(await parseJsonBody(request, greetingTemplateSchema));
    return NextResponse.json({ template });
  });
}
