import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ error: "This callback route is no longer used." }, { status: 410 });
}
