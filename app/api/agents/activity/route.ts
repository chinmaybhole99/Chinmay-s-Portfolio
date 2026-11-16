import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { agentActivities, workspaceAgents, workspaces } from "@/db/schema";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const workspaceId = params.get("workspaceId") ?? "";
  const agentId = params.get("agentId") ?? "";
  const [workspace] = await db.select({ id: workspaces.id }).from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, session.user.id))).limit(1);
  if (!workspace) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  const [agent] = await db.select({ id: workspaceAgents.id }).from(workspaceAgents)
    .where(and(eq(workspaceAgents.id, agentId), eq(workspaceAgents.workspaceId, workspaceId))).limit(1);
  if (!agent) return NextResponse.json({ error: "Agent not found." }, { status: 404 });
  const activities = await db.select().from(agentActivities)
    .where(and(eq(agentActivities.workspaceId, workspaceId), eq(agentActivities.agentId, agentId)))
    .orderBy(desc(agentActivities.createdAt)).limit(30);
  return NextResponse.json(activities);
}
