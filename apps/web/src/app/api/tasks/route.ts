import { NextResponse } from "next/server";
import { createGreetingTasks, store } from "@/lib/store";

export async function GET() {
  return NextResponse.json({ tasks: store.tasks });
}

export async function POST(request: Request) {
  const body = await request.json();
  const tasks = createGreetingTasks(Array.isArray(body.jobIds) ? body.jobIds : []);
  return NextResponse.json({ tasks });
}
