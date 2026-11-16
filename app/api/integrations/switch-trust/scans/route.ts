import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { switchTrustScans, workspaces } from "@/db/schema";
import { enqueueSwitchTrustScan } from "@/lib/cloudhike-trust-scans";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  const [workspace] = await db.select({ id: workspaces.id }).from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, session.user.id))).limit(1);
  if (!workspace) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  const [scan] = await db.select().from(switchTrustScans).where(eq(switchTrustScans.workspaceId, workspaceId))
    .orderBy(desc(switchTrustScans.createdAt)).limit(1);
  return NextResponse.json({ scan: scan ?? null });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const agentId = typeof body?.agentId === "string" ? body.agentId : "";
  if (!workspaceId || !agentId) return NextResponse.json({ error: "Choose an agent to scan." }, { status: 400 });
  try {
    const scan = await enqueueSwitchTrustScan(session.user.id, workspaceId, agentId);
    return NextResponse.json({ scan }, { status: 202 });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Could not start a Switch Trust scan." }, { status: 400 });
  }
}
