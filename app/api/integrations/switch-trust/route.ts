import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq, asc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { switchTrustConnections, workspaceAgents, workspaces } from "@/db/schema";
import { encryptSwitchTrustApiKey, normalizeSwitchTrustInstance } from "@/lib/switch-trust-credentials";
import { enqueueSwitchTrustScan } from "@/lib/cloudhike-trust-scans";

async function signedInUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

export async function GET(request: Request) {
  const user = await signedInUser();
  if (!user) return NextResponse.json({ error: "Sign in to manage integrations." }, { status: 401 });
  const [connection] = await db.select({ instanceUrl: switchTrustConnections.instanceUrl, updatedAt: switchTrustConnections.updatedAt })
    .from(switchTrustConnections).where(eq(switchTrustConnections.userId, user.id)).limit(1);
  const requestedWorkspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  const [workspace] = await db.select({ id: workspaces.id }).from(workspaces)
    .where(requestedWorkspaceId ? and(eq(workspaces.id, requestedWorkspaceId), eq(workspaces.userId, user.id)) : eq(workspaces.userId, user.id))
    .orderBy(asc(workspaces.createdAt)).limit(1);
  const agents = workspace ? await db.select({ id: workspaceAgents.id, name: workspaceAgents.name, slug: workspaceAgents.slug })
    .from(workspaceAgents).where(eq(workspaceAgents.workspaceId, workspace.id)).orderBy(asc(workspaceAgents.createdAt)) : [];
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin).trim().replace(/\/$/, "");
  return NextResponse.json({
    connected: Boolean(connection), instanceUrl: connection?.instanceUrl ?? null, updatedAt: connection?.updatedAt ?? null,
    agentEndpoints: agents.map((agent) => ({ ...agent, url: `${origin}/api/integrations/switch-trust/agents/${encodeURIComponent(agent.id)}/chat/completions` })),
    agentTokenConfigured: Boolean(process.env.SWITCH_TRUST_AGENT_TOKEN),
  });
}

export async function POST(request: Request) {
  const user = await signedInUser();
  if (!user) return NextResponse.json({ error: "Sign in to manage integrations." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  const requestedWorkspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (apiKey.length < 12 || apiKey.length > 512 || /\s/.test(apiKey)) {
    return NextResponse.json({ error: "Enter a valid Switch Trust API key." }, { status: 400 });
  }
  let instanceUrl: string;
  try { instanceUrl = normalizeSwitchTrustInstance(body?.instanceUrl); }
  catch (cause) { return NextResponse.json({ error: cause instanceof Error ? cause.message : "Invalid instance URL." }, { status: 400 }); }

  let encryptedApiKey: string;
  try { encryptedApiKey = encryptSwitchTrustApiKey(apiKey); }
  catch (cause) { return NextResponse.json({ error: cause instanceof Error ? cause.message : "Could not protect this API key." }, { status: 500 }); }
  await db.insert(switchTrustConnections).values({ userId: user.id, encryptedApiKey, instanceUrl, updatedAt: new Date() })
    .onConflictDoUpdate({ target: switchTrustConnections.userId, set: { encryptedApiKey, instanceUrl, updatedAt: new Date() } });
  let initialScan: { id: string; status: string } | null = null;
  let scanError: string | null = null;
  const [workspace] = await db.select({ id: workspaces.id }).from(workspaces)
    .where(requestedWorkspaceId ? and(eq(workspaces.id, requestedWorkspaceId), eq(workspaces.userId, user.id)) : eq(workspaces.userId, user.id))
    .orderBy(asc(workspaces.createdAt)).limit(1);
  if (workspace) {
    const [agent] = await db.select({ id: workspaceAgents.id }).from(workspaceAgents)
      .where(and(eq(workspaceAgents.workspaceId, workspace.id), eq(workspaceAgents.slug, "developer"))).limit(1);
    if (agent) {
      try { initialScan = await enqueueSwitchTrustScan(user.id, workspace.id, agent.id); }
      catch (cause) { scanError = cause instanceof Error ? cause.message : "The key was saved, but the initial scan could not be queued."; }
    }
  }
  return NextResponse.json({ connected: true, instanceUrl, message: "Switch Trust key saved securely.", initialScan, scanError });
}

export async function DELETE() {
  const user = await signedInUser();
  if (!user) return NextResponse.json({ error: "Sign in to manage integrations." }, { status: 401 });
  await db.delete(switchTrustConnections).where(eq(switchTrustConnections.userId, user.id));
  return NextResponse.json({ connected: false });
}
