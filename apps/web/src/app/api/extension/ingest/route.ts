import { NextResponse } from "next/server";
import { upsertConversations, upsertJobs } from "@/lib/store";

export async function POST(request: Request) {
  const body = await request.json();
  const jobs = Array.isArray(body.jobs) ? upsertJobs(body.jobs) : undefined;
  const conversations = Array.isArray(body.conversations) ? upsertConversations(body.conversations) : undefined;
  return NextResponse.json({ ok: true, jobs, conversations });
}
