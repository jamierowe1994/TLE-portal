import { NextResponse } from "next/server";

// Unauthenticated liveness probe (Railway healthcheck).

export async function GET() {
  return NextResponse.json({ ok: true, version: 1 });
}
