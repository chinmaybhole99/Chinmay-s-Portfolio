import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { agentActivities, workspaceAgents, workspaces } from "@/db/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

const modelRates: Record<string, { input: number; output: number }> = {
  "gpt-6-astra": { input: 10, output: 50 },
  "gpt-6.1-sol": { input: 2, output: 10 },
  "gpt-6.1-terra": { input: 1, output: 5 },
  "gpt-6-luna": { input: 0.1, output: 0.5 },
};

type ChatMessage = { role?: unknown; content?: unknown };

function authorized(request: Request) {
  const expected = process.env.SWITCH_TRUST_AGENT_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function messageText(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    const item = part as { type?: unknown; text?: unknown };
    return (item.type === "text" || item.type === "input_text") && typeof item.text === "string" ? [item.text] : [];
  }).join("\n");
}

function outputText(response: any) {
  if (typeof response?.output_text === "string") return response.output_text;
  return (response?.output ?? []).flatMap((item: any) => item.content ?? [])
    .filter((part: any) => part.type === "output_text").map((part: any) => part.text).join("\n");
}

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  if (!process.env.SWITCH_TRUST_AGENT_TOKEN) {
    return NextResponse.json({ error: "Switch Trust agent endpoint is not configured on this server." }, { status: 503 });
  }
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "The agent model provider is not configured." }, { status: 503 });

  const { agentId } = await params;
  const [agent] = await db.select().from(workspaceAgents).where(eq(workspaceAgents.id, agentId)).limit(1);
  if (!agent || !agent.enabled) return NextResponse.json({ error: "Agent not found or disabled." }, { status: 404 });
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, agent.workspaceId)).limit(1);
  if (!workspace) return NextResponse.json({ error: "Agent workspace not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.messages) || body.stream === true) {
    return NextResponse.json({ error: "Send a non-streaming OpenAI-compatible chat completion request." }, { status: 400 });
  }
  const messages = (body.messages as ChatMessage[]).slice(-30);
  const systemContext = messages.filter((message) => message.role === "system" || message.role === "developer")
    .map((message) => messageText(message.content)).filter(Boolean).join("\n\n").slice(0, 8000);
  const input = messages.filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({ role: message.role as "user" | "assistant", content: messageText(message.content).slice(0, 8000) }))
    .filter((message) => message.content);
  if (!input.length) return NextResponse.json({ error: "The request must contain a user message." }, { status: 400 });

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const previousUsage = await db.select({ costMicros: agentActivities.costMicros }).from(agentActivities)
    .where(and(eq(agentActivities.workspaceId, agent.workspaceId), eq(agentActivities.agentId, agent.id), gte(agentActivities.createdAt, monthStart)));
  const usedMicros = previousUsage.reduce((total, usage) => total + usage.costMicros, 0);
  if (usedMicros >= agent.budgetCents * 10_000) return NextResponse.json({ error: "This agent has reached its monthly budget." }, { status: 402 });

  const skills = agent.skills.length ? `\n\nActive skills:\n${agent.skills.map((skill) => `- ${skill}`).join("\n")}` : "";
  const instructions = `${agent.instructions}${skills}${systemContext ? `\n\nEvaluation context:\n${systemContext}` : ""}`;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: agent.model, instructions, input, max_output_tokens: 1800, store: false }),
    cache: "no-store",
    signal: AbortSignal.timeout(50_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) return NextResponse.json({ error: result?.error?.message || "The agent could not complete the evaluation prompt." }, { status: response.status });

  const text = outputText(result);
  const usage = result?.usage ?? {};
  const inputTokens = Number(usage.input_tokens) || 0;
  const outputTokens = Number(usage.output_tokens) || 0;
  const rate = modelRates[agent.model] ?? modelRates["gpt-6.1-terra"];
  const costMicros = Math.ceil(inputTokens * rate.input + outputTokens * rate.output);
  await db.insert(agentActivities).values({
    id: crypto.randomUUID(), workspaceId: agent.workspaceId, agentId: agent.id, kind: "trust_evaluation",
    title: "Switch Trust evaluation prompt", details: text.slice(0, 4000) || "The model returned no text output.",
    model: agent.model, inputTokens, outputTokens, costMicros,
  });

  return NextResponse.json({
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: agent.model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
  });
}
