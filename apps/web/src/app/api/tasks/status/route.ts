import { NextResponse } from "next/server";
import { greetingTaskSchema } from "@boss-agent/shared";
import { updateTaskStatus } from "@/lib/store";

export async function POST(request: Request) {
  const body = await request.json();
  const status = greetingTaskSchema.shape.status.parse(body.status);
  const task = updateTaskStatus(String(body.taskId), status, String(body.failureReason ?? ""));
  return NextResponse.json({ task });
}
