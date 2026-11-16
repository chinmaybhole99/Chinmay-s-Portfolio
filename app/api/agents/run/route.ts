import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { agentActivities, workspaceAgents, workspaces } from "@/db/schema";

const modelRates: Record<string, { input: number; output: number }> = {
  "gpt-6-astra": { input: 10, output: 50 },
  "gpt-6.1-sol": { input: 2, output: 10 },
  "gpt-6.1-terra": { input: 1, output: 5 },
  "gpt-6-luna": { input: 0.1, output: 0.5 },
};

function getOutputText(response: any) {
  if (typeof response.output_text === "string") return response.output_text;
  return (response.output ?? []).flatMap((item: any) => item.content ?? [])
    .filter((part: any) => part.type === "output_text").map((part: any) => part.text).join("\n");
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OpenAI is not connected yet. Add OPENAI_API_KEY to the server environment." }, { status: 503 });
  const body = await request.json().catch(() => null);
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const agentId = typeof body?.agentId === "string" ? body.agentId : "";
  const task = typeof body?.task === "string" ? body.task.trim().slice(0, 6000) : "";
  if (!workspaceId || !agentId || !task) return NextResponse.json({ error: "Choose an agent and enter a task." }, { status: 400 });

  const [workspace] = await db.select().from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, session.user.id))).limit(1);
  if (!workspace) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  const [agent] = await db.select().from(workspaceAgents)
    .where(and(eq(workspaceAgents.id, agentId), eq(workspaceAgents.workspaceId, workspaceId))).limit(1);
  if (!agent || !agent.enabled) return NextResponse.json({ error: "This agent is unavailable." }, { status: 404 });

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const previousUsage = await db.select({ costMicros: agentActivities.costMicros }).from(agentActivities)
    .where(and(eq(agentActivities.workspaceId, workspaceId), eq(agentActivities.agentId, agentId), gte(agentActivities.createdAt, monthStart)));
  const usedMicros = previousUsage.reduce((total, usage) => total + usage.costMicros, 0);
  const monthlyBudgetMicros = agent.budgetCents * 10_000;
  if (usedMicros >= monthlyBudgetMicros) return NextResponse.json({ error: "This agent has reached its monthly budget. Increase the budget in Configure to continue." }, { status: 402 });

  const availableTools: Record<string, unknown>[] = [];
  if (agent.tools.includes("web_search")) availableTools.push({ type: "web_search" });
  if (agent.tools.includes("code_interpreter")) availableTools.push({ type: "code_interpreter", container: { type: "auto" } });
  if (agent.tools.includes("image_generation")) availableTools.push({ type: "image_generation" });
  if (agent.tools.includes("file_search") && process.env.OPENAI_VECTOR_STORE_ID) {
    availableTools.push({ type: "file_search", vector_store_ids: [process.env.OPENAI_VECTOR_STORE_ID] });
  }
  const skills = agent.skills.length ? `\n\nActive skills:\n${agent.skills.map((skill) => `- ${skill}`).join("\n")}` : "";
  const instructions = `${agent.instructions}${skills}\n\nWorkspace: ${workspace.name}\nConnected repository: ${workspace.repository}. The repository contents are not directly mounted into this agent runtime. Never claim to have edited files, opened pull requests, or run repository tests unless a connected tool has done so.`;

  const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: agent.model, instructions, input: task, tools: availableTools, max_output_tokens: 1800, store: false }),
    cache: "no-store",
  });
  const result = await openAIResponse.json().catch(() => null);
  if (!openAIResponse.ok) return NextResponse.json({ error: result?.error?.message || "OpenAI could not run this agent." }, { status: openAIResponse.status });

  const usage = result?.usage ?? {};
  const inputTokens = Number(usage.input_tokens) || 0;
  const outputTokens = Number(usage.output_tokens) || 0;
  const rate = modelRates[agent.model] ?? modelRates["gpt-6.1-terra"];
  const costMicros = Math.ceil(inputTokens * rate.input + outputTokens * rate.output);
  const outputText = getOutputText(result).slice(0, 12_000);
  await db.insert(agentActivities).values({
    id: crypto.randomUUID(), workspaceId, agentId: agent.id, kind: "run",
    title: `Completed a ${agent.role.toLowerCase()} run`,
    details: outputText.slice(0, 4000) || "The model returned no text output.",
    model: agent.model, inputTokens, outputTokens, costMicros,
  });
  return NextResponse.json({ output: outputText, usage: { inputTokens, outputTokens }, estimatedCostMicros: costMicros });
}
