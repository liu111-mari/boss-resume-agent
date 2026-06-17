import { NextResponse } from "next/server";
import { analyzeJD } from "@/lib/ai";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = await analyzeJD(String(body.jdText ?? ""));
  return NextResponse.json({ parsed });
}
