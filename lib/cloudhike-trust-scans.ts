import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { switchTrustConnections, switchTrustScans, workspaceAgents, workspaces } from "@/db/schema";
import { decryptSwitchTrustApiKey } from "@/lib/switch-trust-credentials";
import { prepareFastSwitchTrustEvaluation } from "@/lib/switch-trust-evaluations";

const cloudHikeRunsUrl = "https://cloudhike.dev/api/jobs-service/dev-crew-km6bbq/runs";

export async function enqueueSwitchTrustScan(userId: string, workspaceId: string, agentId: string) {
  const [workspace] = await db.select({ id: workspaces.id }).from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId))).limit(1);
  if (!workspace) throw new Error("Workspace not found.");
  const [agent] = await db.select({ id: workspaceAgents.id }).from(workspaceAgents)
    .where(and(eq(workspaceAgents.id, agentId), eq(workspaceAgents.workspaceId, workspaceId))).limit(1);
  if (!agent) throw new Error("Agent not found in this workspace.");
  const [connection] = await db.select().from(switchTrustConnections).where(eq(switchTrustConnections.userId, userId)).limit(1);
  if (!connection) throw new Error("Connect Switch Trust before starting a scan.");
  const jobsApiKey = process.env.JOBS_API_KEY;
  if (!jobsApiKey) throw new Error("JOBS_API_KEY is not configured on the server.");

  const [agentRecord] = await db.select({ name: workspaceAgents.name }).from(workspaceAgents).where(eq(workspaceAgents.id, agentId)).limit(1);
  if (!agentRecord) throw new Error("Agent not found in this workspace.");
  const apiKey = decryptSwitchTrustApiKey(connection.encryptedApiKey);
  const { triggerUrl } = await prepareFastSwitchTrustEvaluation({ instanceUrl: connection.instanceUrl, apiKey, agentName: agentRecord.name });
  const scanId = crypto.randomUUID();
  await db.insert(switchTrustScans).values({ id: scanId, workspaceId, agentId, status: "queued" });
  try {
    const response = await fetch(cloudHikeRunsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": jobsApiKey },
      body: JSON.stringify({
        url: triggerUrl,
        method: "POST",
        headers: { authorization: `ApiKey ${apiKey}` },
        timeoutSeconds: 300,
        retries: 3,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || typeof result?.id !== "string") throw new Error("CloudHike could not queue the Switch Trust scan.");
    await db.update(switchTrustScans).set({ cloudHikeRunId: result.id, updatedAt: new Date() }).where(eq(switchTrustScans.id, scanId));
    return { id: scanId, status: "queued" as const };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Could not queue the Switch Trust scan.";
    await db.update(switchTrustScans).set({ status: "failed", error: message.slice(0, 500), updatedAt: new Date() }).where(eq(switchTrustScans.id, scanId));
    throw cause;
  }
}

export async function latestSwitchTrustScan(workspaceId: string) {
  const [scan] = await db.select().from(switchTrustScans).where(eq(switchTrustScans.workspaceId, workspaceId))
    .orderBy(desc(switchTrustScans.createdAt)).limit(1);
  return scan ?? null;
}

export async function latestSwitchTrustScansByAgent(workspaceId: string) {
  const scans = await db.select().from(switchTrustScans).where(eq(switchTrustScans.workspaceId, workspaceId))
    .orderBy(desc(switchTrustScans.createdAt));
  const latest = new Map<string, (typeof scans)[number]>();
  for (const scan of scans) if (!latest.has(scan.agentId)) latest.set(scan.agentId, scan);
  return latest;
}
