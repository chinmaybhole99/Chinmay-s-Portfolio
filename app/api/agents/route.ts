import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { and, desc, eq, gte } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { agentActivities, workspaceAgents, workspaces } from "@/db/schema";
import { availableAgentTools, defaultAgents } from "@/lib/agents";
import { latestSwitchTrustScan, latestSwitchTrustScansByAgent } from "@/lib/cloudhike-trust-scans";
import { enqueueSwitchTrustScan } from "@/lib/cloudhike-trust-scans";

async function getWorkspace(request: Request, workspaceId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { response: NextResponse.json({ error: "Sign in to continue." }, { status: 401 }) };
  const [workspace] = await db.select({ id: workspaces.id }).from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, session.user.id))).limit(1);
  if (!workspace) return { response: NextResponse.json({ error: "Workspace not found." }, { status: 404 }) };
  return { userId: session.user.id, workspace };
}

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!workspaceId) return NextResponse.json({ error: "Choose a workspace first." }, { status: 400 });
  const context = await getWorkspace(request, workspaceId);
  if ("response" in context) return context.response;

  const existing = await db.select({ slug: workspaceAgents.slug }).from(workspaceAgents).where(eq(workspaceAgents.workspaceId, workspaceId));
  const existingSlugs = new Set(existing.map((agent) => agent.slug));
  const seeds = defaultAgents.filter((agent) => !existingSlugs.has(agent.slug)).map((agent) => ({
    id: crypto.randomUUID(), workspaceId, ...agent,
    skills: [...agent.skills], tools: availableAgentTools(), enabled: true,
  }));
  if (seeds.length) await db.insert(workspaceAgents).values(seeds).onConflictDoNothing();

  const agents = await db.select().from(workspaceAgents).where(eq(workspaceAgents.workspaceId, workspaceId)).orderBy(workspaceAgents.createdAt);
  const trustScan = await latestSwitchTrustScan(workspaceId);
  const trustScansByAgent = await latestSwitchTrustScansByAgent(workspaceId);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const usage = await db.select({ agentId: agentActivities.agentId, costMicros: agentActivities.costMicros, inputTokens: agentActivities.inputTokens, outputTokens: agentActivities.outputTokens })
    .from(agentActivities).where(and(eq(agentActivities.workspaceId, workspaceId), gte(agentActivities.createdAt, monthStart)));
  const usageByAgent = new Map<string, { spendMicros: number; inputTokens: number; outputTokens: number; calls: number }>();
  for (const item of usage) {
    const previous = usageByAgent.get(item.agentId) ?? { spendMicros: 0, inputTokens: 0, outputTokens: 0, calls: 0 };
    previous.spendMicros += item.costMicros;
    previous.inputTokens += item.inputTokens;
    previous.outputTokens += item.outputTokens;
    previous.calls += 1;
    usageByAgent.set(item.agentId, previous);
  }
  return NextResponse.json({
    agents: agents.map((agent) => ({ ...agent, trustScore: trustScansByAgent.get(agent.id)?.score ?? null, latestTrustScanId: trustScansByAgent.get(agent.id)?.id ?? null, usage: usageByAgent.get(agent.id) ?? { spendMicros: 0, inputTokens: 0, outputTokens: 0, calls: 0 } })),
    monthlySpendMicros: usage.reduce((total, item) => total + item.costMicros, 0),
    trustScore: trustScan?.score ?? null,
    trustScan: trustScan ? { id: trustScan.id, agentId: trustScan.agentId, status: trustScan.status, score: trustScan.score, report: trustScan.report, error: trustScan.error, createdAt: trustScan.createdAt } : null,
    openAIConfigured: Boolean(process.env.OPENAI_API_KEY),
    vectorStoreConfigured: Boolean(process.env.OPENAI_VECTOR_STORE_ID),
    availableTools: availableAgentTools(),
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!workspaceId) return NextResponse.json({ error: "Choose a workspace first." }, { status: 400 });
  const context = await getWorkspace(request, workspaceId);
  if ("response" in context) return context.response;

  const agents = await db.select().from(workspaceAgents).where(eq(workspaceAgents.workspaceId, workspaceId));
  if (body?.action === "scan") {
    const agentId = typeof body?.agentId === "string" ? body.agentId : "";
    if (!agents.some((agent) => agent.id === agentId)) return NextResponse.json({ error: "Choose an agent to scan." }, { status: 400 });
    try { return NextResponse.json({ scan: await enqueueSwitchTrustScan(context.userId, workspaceId, agentId) }, { status: 202 }); }
    catch (cause) { return NextResponse.json({ error: cause instanceof Error ? cause.message : "Could not start a Switch Trust scan." }, { status: 400 }); }
  }

  const agentId = typeof body?.agentId === "string" ? body.agentId : "";
  const [agent] = await db.select().from(workspaceAgents)
    .where(and(eq(workspaceAgents.id, agentId), eq(workspaceAgents.workspaceId, workspaceId))).limit(1);
  if (!agent) return NextResponse.json({ error: "Agent not found." }, { status: 404 });
  const allowedTools = availableAgentTools();
  const tools = Array.isArray(body?.tools) ? body.tools.filter((tool: unknown): tool is string => typeof tool === "string" && allowedTools.includes(tool)) : agent.tools;
  const skills = Array.isArray(body?.skills) ? body.skills.filter((skill: unknown): skill is string => typeof skill === "string").slice(0, 12) : agent.skills;
  const instructions = typeof body?.instructions === "string" ? body.instructions.trim().slice(0, 8000) : agent.instructions;
  const description = typeof body?.description === "string" ? body.description.trim().slice(0, 500) : agent.description;
  const budgetCents = Number.isInteger(body?.budgetCents) ? Math.max(100, Math.min(1_000_000, body.budgetCents)) : agent.budgetCents;
  const modelAllowlist = ["gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna", "gpt-6-astra"];
  const model = modelAllowlist.includes(body?.model) ? body.model : agent.model;
  if (instructions.length < 40) return NextResponse.json({ error: "Add at least 40 characters of clear agent instructions." }, { status: 400 });
  const [updated] = await db.update(workspaceAgents).set({ description, instructions, skills, tools, budgetCents, model, updatedAt: new Date() })
    .where(and(eq(workspaceAgents.id, agent.id), eq(workspaceAgents.workspaceId, workspaceId))).returning();
  await db.insert(agentActivities).values({ id: crypto.randomUUID(), workspaceId, agentId: agent.id, kind: "configured", title: "Agent configuration updated", details: `${agent.name} instructions, tools, skills, or budget were updated.`, model });
  return NextResponse.json(updated);
}
