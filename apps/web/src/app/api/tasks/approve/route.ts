import { NextResponse } from "next/server";
import { approveTasks } from "@/lib/store";

export async function POST(request: Request) {
  const body = await request.json();
  const tasks = approveTasks(Array.isArray(body.taskIds) ? body.taskIds : []);
  return NextResponse.json({ tasks });
}
