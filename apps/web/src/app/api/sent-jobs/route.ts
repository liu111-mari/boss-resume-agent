import { NextResponse } from "next/server";

import { getDomainStore } from "@/lib/domain-store";
import { withApiErrorHandling } from "@/lib/http";

export async function GET() {
  return withApiErrorHandling(async () => {
    const jobs = await getDomainStore().getSentJobs();
    return NextResponse.json({ jobs });
  });
}
