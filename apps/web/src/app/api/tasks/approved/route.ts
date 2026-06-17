import { NextResponse } from "next/server";
import { getApprovedTasks } from "@/lib/store";

export async function GET() {
  return NextResponse.json({ tasks: getApprovedTasks() });
}
