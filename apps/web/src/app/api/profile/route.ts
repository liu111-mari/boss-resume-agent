import { profileSchema } from "@boss-agent/shared";
import { NextResponse } from "next/server";

import { getDomainStore } from "@/lib/domain-store";
import { parseJsonBody, withApiErrorHandling } from "@/lib/http";

export async function GET() {
  return withApiErrorHandling(async () => {
    const profile = await getDomainStore().getProfile();
    return NextResponse.json({ profile });
  });
}

export async function PUT(request: Request) {
  return withApiErrorHandling(async () => {
    const profile = await getDomainStore().saveProfile(await parseJsonBody(request, profileSchema));
    return NextResponse.json({ profile });
  });
}
