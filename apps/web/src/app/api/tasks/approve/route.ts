import { NextResponse } from "next/server";
import { z } from "zod";

import { getDomainStore } from "@/lib/domain-store";
import { parseJsonBody, withApiErrorHandling } from "@/lib/http";

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const body = await parseJsonBody(
      request,
      z.object({
        taskIds: z.array(z.string())
      })
    );
    const tasks = await getDomainStore().approveTasks(body.taskIds);
    return NextResponse.json({ tasks });
  });
}
