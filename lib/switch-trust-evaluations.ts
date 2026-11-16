const apiVersion = "/api/v1";

function apiOrigin(instanceUrl: string) {
  const url = new URL(instanceUrl);
  url.hostname = url.hostname.replace(/^app\./i, "api.");
  return url.origin;
}

async function switchTrustRequest<T>(instanceUrl: string, apiKey: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `ApiKey ${apiKey}`);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${apiOrigin(instanceUrl)}${apiVersion}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof result?.message === "string" ? result.message : typeof result?.error === "string" ? result.error : `Switch Trust returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  return result as T;
}

function pathPart(value: string) { return encodeURIComponent(value); }

function normalizeName(value: unknown) {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() : "";
}

function inventoryRows(payload: unknown) {
  if (!payload || typeof payload !== "object") return [];
  const page = payload as { header?: unknown[]; rows?: unknown[][] };
  if (!Array.isArray(page.header) || !Array.isArray(page.rows)) return [];
  const headers = page.header.map((name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
  return page.rows.map((row) => Object.fromEntries(headers.map((name, index) => [name, row[index]])));
}

type AgentEvaluation = { id: string; agent_id: string; evaluation_id: string; evaluation_name?: string };
type Evaluation = { id: string; num_prompts?: number; name?: string };
type EvaluationResult = { items?: Array<{ score?: number | null; status?: string }> };

async function resolveFastAssignment({ instanceUrl, apiKey, agentName }: { instanceUrl: string; apiKey: string; agentName: string }) {
  const identity = await switchTrustRequest<{ tenant_id?: string; workspace_id?: string }>(instanceUrl, apiKey, "/auth/api-key/identity");
  const tenantId = identity.tenant_id;
  const workspaceId = identity.workspace_id;
  if (!tenantId || !workspaceId) throw new Error("This Switch Trust key has no active tenant workspace.");
  const scope = `/tenants/${pathPart(tenantId)}/workspaces/${pathPart(workspaceId)}`;

  const inventory = await switchTrustRequest<unknown>(instanceUrl, apiKey, `/aispm-agents${scope}?sort=name&sort_dir=asc`);
  const desiredName = normalizeName(agentName);
  const rows = inventoryRows(inventory);
  const namedRows = rows.map((row) => ({ row, name: normalizeName(row.name ?? row.agent_name ?? row.display_name ?? row.asset_name ?? row.agent) }))
    .filter((item) => item.name && [item.row.id, item.row.agent_id, item.row.asset_id].some((value) => typeof value === "string"));
  const exactAgent = namedRows.find((item) => item.name === desiredName);
  const closeMatches = namedRows.filter((item) => item.name.endsWith(` ${desiredName}`) || desiredName.endsWith(` ${item.name}`));
  // Local app agents often have different names from Switch Trust assets. If
  // the connected account has exactly one asset, it is an unambiguous target.
  const soleAgent = namedRows.length === 1 ? namedRows[0] : undefined;
  const agentRow = exactAgent?.row ?? (closeMatches.length === 1 ? closeMatches[0].row : soleAgent?.row);
  const externalAgentName = exactAgent?.name ?? (closeMatches.length === 1 ? closeMatches[0].name : soleAgent?.name) ?? "";
  const externalAgentId = [agentRow?.id, agentRow?.agent_id, agentRow?.asset_id].find((value) => typeof value === "string") as string | undefined ?? "";
  if (!externalAgentId) {
    if (namedRows.length === 0) {
      throw new Error("This Switch Trust workspace has no readable inventoried agents for the connected API key. Discover or onboard the agent in Switch Trust, configure its evaluation endpoint, then try the scan again.");
    }
    const choices = namedRows.map((item) => String(item.row.name ?? item.row.agent_name ?? item.row.display_name ?? item.row.asset_name ?? item.row.agent)).filter(Boolean);
    if (choices.length > 1) throw new Error(`No Switch Trust asset matches ${agentName}. Available assets: ${choices.join(", ")}. Rename an asset to match or connect a workspace with a single asset.`);
    throw new Error(`Switch Trust does not have an inventoried agent named ${agentName}. Add that agent to the connected Switch Trust workspace first.`);
  }

  const assignments = await switchTrustRequest<{ items?: AgentEvaluation[] }>(instanceUrl, apiKey,
    `/eval/agent-evaluations${scope}?agent_id=${encodeURIComponent(externalAgentId)}&page_size=100`);
  const agentEvaluations = Array.isArray(assignments.items) ? assignments.items : [];
  if (!agentEvaluations.length) throw new Error(`No Switch Trust evaluation is assigned to the ${externalAgentName} asset. Assign an evaluation to this asset in Switch Trust first.`);

  const definitions = await switchTrustRequest<{ items?: Evaluation[] }>(instanceUrl, apiKey, `/eval/evaluations${scope}?page_size=100`);
  const promptsById = new Map<string, number>((definitions.items ?? []).map((evaluation) => [evaluation.id, evaluation.num_prompts ?? Number.MAX_SAFE_INTEGER] as const));
  const selected = agentEvaluations
    .filter((assignment) => (promptsById.get(assignment.evaluation_id) ?? 0) > 0)
    .sort((left, right) => (promptsById.get(left.evaluation_id) ?? Number.MAX_SAFE_INTEGER) - (promptsById.get(right.evaluation_id) ?? Number.MAX_SAFE_INTEGER))[0];
  if (!selected?.id) throw new Error(`Could not select a fast Switch Trust evaluation for the ${externalAgentName} asset.`);

  return { scope, assignmentId: selected.id, evaluationName: selected.evaluation_name ?? selected.evaluation_id, externalAgentId, externalAgentName };
}

export async function prepareFastSwitchTrustEvaluation(input: { instanceUrl: string; apiKey: string; agentName: string }) {
  const assignment = await resolveFastAssignment(input);
  return {
    triggerUrl: `${apiOrigin(input.instanceUrl)}${apiVersion}/eval/agent-evaluations${assignment.scope}/${pathPart(assignment.assignmentId)}/trigger`,
  };
}

export async function getSwitchTrustEvaluationResult({ instanceUrl, apiKey, agentName, runId }: { instanceUrl: string; apiKey: string; agentName: string; runId: string }) {
  const assignment = await resolveFastAssignment({ instanceUrl, apiKey, agentName });
  const runPath = `/eval/evaluation-runs${assignment.scope}/${pathPart(runId)}`;
  const run = await switchTrustRequest<{ status?: string; summary?: Record<string, unknown>; error_message?: string }>(instanceUrl, apiKey, runPath);
  if (run.status === "error") throw new Error(run.error_message || "Switch Trust evaluation failed.");
  if (run.status !== "finished") return { status: "running" as const };

  const results = await switchTrustRequest<EvaluationResult>(instanceUrl, apiKey, `${runPath}/results?page=1&page_size=100`);
  const scores = (results.items ?? []).map((item) => item.score).filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  const summary = run.summary ?? {};
  const summaryScore = [summary.score, summary.health_score, summary.overall_score].find((value): value is number => typeof value === "number" && Number.isFinite(value));
  const rawScore = scores.length ? scores.reduce((total, score) => total + score, 0) / scores.length : summaryScore;
  if (rawScore === undefined) throw new Error("Switch Trust finished the evaluation without returning a score.");
  const score = Math.max(0, Math.min(100, Math.round(rawScore <= 1 ? rawScore * 100 : rawScore)));
  let roi: Array<{ analysisType: string; estimatedSavingsUsd: number }> = [];
  try {
    const roiResult = await switchTrustRequest<unknown>(instanceUrl, apiKey, `/roi/analyses/latest${assignment.scope}?agent_id=${encodeURIComponent(assignment.externalAgentId)}`);
    const rows = Array.isArray(roiResult) ? roiResult : roiResult && typeof roiResult === "object" && Array.isArray((roiResult as { items?: unknown[] }).items) ? (roiResult as { items: unknown[] }).items : Object.values((roiResult && typeof roiResult === "object" ? roiResult : {}) as Record<string, unknown>);
    roi = rows.flatMap((row) => row && typeof row === "object" && typeof (row as { estimated_savings_usd?: unknown }).estimated_savings_usd === "number"
      ? [{ analysisType: String((row as { analysis_type?: unknown }).analysis_type ?? "optimization"), estimatedSavingsUsd: (row as { estimated_savings_usd: number }).estimated_savings_usd }]
      : []);
  } catch { /* ROI is optional; a completed Trust evaluation still has a valid score. */ }
  return { status: "succeeded" as const, runId, score, report: { summary: `Switch Trust asset: ${assignment.externalAgentName} · fastest assigned evaluation: ${assignment.evaluationName}`, findings: (results.items ?? []).map((item, index) => ({ label: `Evaluation prompt ${index + 1}`, score: item.score == null ? null : Math.max(0, Math.min(100, Math.round(item.score <= 1 ? item.score * 100 : item.score))), status: item.status })), roi } };
}
