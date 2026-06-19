import { greetingTaskSchema } from "@boss-agent/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDomainStore } from "@/lib/domain-store";
import { parseJsonBody, withApiErrorHandling } from "@/lib/http";

export async function GET() {
  return withApiErrorHandling(async () => {
    const tasks = await getDomainStore().getTasks();
    return NextResponse.json({ tasks });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const body = await parseJsonBody(
      request,
      z.object({
        task: greetingTaskSchema
      })
    );
    const task = await getDomainStore().createOrUpdateTask(body.task);
    return NextResponse.json({ task });
  });
}
