import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { switchTrustConnections, switchTrustScans, workspaceAgents, workspaces } from "@/db/schema";
import { decryptSwitchTrustApiKey } from "@/lib/switch-trust-credentials";
import { getSwitchTrustEvaluationResult } from "@/lib/switch-trust-evaluations";

function findEvaluationRunId(value: unknown, depth = 0): string | null {
  if (depth > 8 || value == null) return null;
  if (typeof value === "string") {
    try { return findEvaluationRunId(JSON.parse(value), depth + 1); } catch { return null; }
  }
  if (Array.isArray(value)) {
    for (const item of value) { const found = findEvaluationRunId(item, depth + 1); if (found) return found; }
    return null;
  }
  if (typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  for (const key of ["run_id", "runId", "evaluation_run_id", "evaluationRunId"]) {
    if (typeof object[key] === "string") return object[key] as string;
  }
  for (const item of Object.values(object)) { const found = findEvaluationRunId(item, depth + 1); if (found) return found; }
  return null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ scanId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const { scanId } = await params;
  const [scan] = await db.select({ scan: switchTrustScans }).from(switchTrustScans)
    .innerJoin(workspaces, eq(workspaces.id, switchTrustScans.workspaceId))
    .where(and(eq(switchTrustScans.id, scanId), eq(workspaces.userId, session.user.id))).limit(1);
  if (!scan) return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  const { scan: result } = scan;

  if (["queued", "running"].includes(result.status) && result.cloudHikeRunId && process.env.JOBS_API_KEY) {
    try {
      const response = await fetch(`https://cloudhike.dev/api/jobs-service/dev-crew-km6bbq/runs/${encodeURIComponent(result.cloudHikeRunId)}`, {
        headers: { "x-api-key": process.env.JOBS_API_KEY }, cache: "no-store", signal: AbortSignal.timeout(8_000),
      });
      if (response.ok) {
        const payload = await response.json().catch(() => null);
        const job = payload?.run ?? payload;
        const jobStatus = typeof job?.status === "string" ? job.status.toLowerCase() : "";
        if (["failed", "error", "cancelled"].includes(jobStatus)) {
          const error = "CloudHike could not trigger the Switch Trust evaluation.";
          await db.update(switchTrustScans).set({ status: "failed", error, updatedAt: new Date() }).where(eq(switchTrustScans.id, result.id));
          return NextResponse.json({ scan: { ...result, status: "failed", error } });
        }
        let runId = result.switchTrustRunId ?? findEvaluationRunId(job);
        if (!runId && ["succeeded", "success", "completed", "finished"].includes(jobStatus)) {
          const error = "CloudHike finished without returning a Switch Trust run ID.";
          await db.update(switchTrustScans).set({ status: "failed", error, updatedAt: new Date() }).where(eq(switchTrustScans.id, result.id));
          return NextResponse.json({ scan: { ...result, status: "failed", error } });
        }
        if (runId && !result.switchTrustRunId) {
          await db.update(switchTrustScans).set({ switchTrustRunId: runId, status: "running", updatedAt: new Date() }).where(eq(switchTrustScans.id, result.id));
        }
        if (runId) {
          const [workspace] = await db.select({ userId: workspaces.userId }).from(workspaces).where(eq(workspaces.id, result.workspaceId)).limit(1);
          const [agent] = await db.select({ name: workspaceAgents.name }).from(workspaceAgents).where(eq(workspaceAgents.id, result.agentId)).limit(1);
          const [connection] = workspace ? await db.select().from(switchTrustConnections).where(eq(switchTrustConnections.userId, workspace.userId)).limit(1) : [];
          if (!workspace || !agent || !connection) throw new Error("Switch Trust connection or scan agent was not found.");
          const evaluation = await getSwitchTrustEvaluationResult({ instanceUrl: connection.instanceUrl, apiKey: decryptSwitchTrustApiKey(connection.encryptedApiKey), agentName: agent.name, runId });
          if (evaluation.status === "succeeded") {
            const report = { ...evaluation.report, findings: evaluation.report.findings.slice(0, 100) };
            const completed = { ...result, status: "succeeded", switchTrustRunId: runId, score: evaluation.score, report, error: null };
            await db.update(switchTrustScans).set({ status: "succeeded", switchTrustRunId: runId, score: evaluation.score, report, error: null, updatedAt: new Date() }).where(eq(switchTrustScans.id, result.id));
            return NextResponse.json({ scan: completed });
          }
          const running = { ...result, status: "running", switchTrustRunId: runId };
          return NextResponse.json({ scan: running });
        }
      }
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : "Switch Trust evaluation failed.";
      if (result.switchTrustRunId) {
        await db.update(switchTrustScans).set({ status: "failed", error: error.slice(0, 500), updatedAt: new Date() }).where(eq(switchTrustScans.id, result.id));
        return NextResponse.json({ scan: { ...result, status: "failed", error } });
      }
    }
  }

  return NextResponse.json({ scan: result });
}
