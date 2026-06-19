import { filterConfigSchema } from "@boss-agent/shared";
import { NextResponse } from "next/server";

import { getDomainStore } from "@/lib/domain-store";
import { parseJsonBody, withApiErrorHandling } from "@/lib/http";

export async function GET() {
  return withApiErrorHandling(async () => {
    const config = await getDomainStore().getConfig();
    return NextResponse.json({ config });
  });
}

export async function PUT(request: Request) {
  return withApiErrorHandling(async () => {
    const config = await getDomainStore().saveConfig(await parseJsonBody(request, filterConfigSchema));
    return NextResponse.json({ config });
  });
}
