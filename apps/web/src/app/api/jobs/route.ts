import { NextResponse } from "next/server";
import { store, upsertJobs } from "@/lib/store";

export async function GET() {
  return NextResponse.json({ jobs: store.jobs });
}

export async function POST(request: Request) {
  const body = await request.json();
  const jobs = upsertJobs(Array.isArray(body.jobs) ? body.jobs : [body]);
  return NextResponse.json({ jobs });
}
