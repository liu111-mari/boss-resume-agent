import { NextResponse } from "next/server";
import { parsedJDSchema } from "@boss-agent/shared";
import { generateResume } from "@/lib/ai";
import { sampleProfileAssets } from "@/lib/sample-profile";

export async function POST(request: Request) {
  const body = await request.json();
  const parsedJD = parsedJDSchema.parse(body.parsedJD);
  const targetJob = String(body.targetJob ?? "目标岗位");
  const resume = await generateResume(parsedJD, sampleProfileAssets, targetJob);
  return NextResponse.json({ resume });
}
