import { NextResponse } from "next/server";
import { store, upsertConversations } from "@/lib/store";

export async function GET() {
  return NextResponse.json({ conversations: store.conversations });
}

export async function POST(request: Request) {
  const body = await request.json();
  const conversations = upsertConversations(Array.isArray(body.conversations) ? body.conversations : [body]);
  return NextResponse.json({ conversations });
}
