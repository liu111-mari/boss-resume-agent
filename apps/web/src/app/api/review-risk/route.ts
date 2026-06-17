import { NextResponse } from "next/server";
import { reviewRisk } from "@/lib/ai";

export async function POST(request: Request) {
  const body = await request.json();
  return NextResponse.json({ risks: reviewRisk(String(body.markdown ?? "")) });
}
