import { NextResponse } from "next/server";

import { getDomainStore } from "@/lib/domain-store";
import { withApiErrorHandling } from "@/lib/http";

export async function GET() {
  return withApiErrorHandling(async () => {
    const tasks = await getDomainStore().getTasks();
    return NextResponse.json({ tasks });
  });
}
