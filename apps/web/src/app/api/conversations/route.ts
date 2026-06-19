import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error: "removed"
    },
    { status: 410 }
  );
}

export async function POST(request: Request) {
  void request;
  return NextResponse.json(
    {
      error: "removed"
    },
    { status: 410 }
  );
}
