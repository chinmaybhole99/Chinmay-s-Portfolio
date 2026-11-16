"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Activity, ArrowUpRight, Bot, Check, ChevronRight, CircleDollarSign, Clock3, Code2, FlaskConical, Image, KeyRound, Link2, LoaderCircle, LockKeyhole, Search, ShieldCheck, Sparkles, X } from "lucide-react";

type Agent = {
  id: string; slug: string; name: string; role: string; description: string; instructions: string; model: string;
  skills: string[]; tools: string[]; budgetCents: number; enabled: boolean; trustScore: number | null;
  usage: { spendMicros: number; inputTokens: number; outputTokens: number; calls: number };
};
type ToolInfo = { id: string; label: string; description: string; state: string };
type ActivityItem = { id: string; kind: string; title: string; details: string; model: string | null; inputTokens: number; outputTokens: number; costMicros: number; createdAt: string };
type TrustScan = { id: string; agentId: string; status: string; score: number | null; report: { summary?: string; findings?: Array<{ label: string; score?: number | null; status?: string }>; roi?: Array<{ analysisType: string; estimatedSavingsUsd: number }> } | null; error: string | null; createdAt: string };
type AgentData = { agents: Agent[]; monthlySpendMicros: number; trustScore: number | null; trustScan: TrustScan | null; openAIConfigured: boolean; vectorStoreConfigured: boolean; availableTools: string[]; tools: ToolInfo[] };
type SwitchTrustConnection = { connected: boolean; instanceUrl: string | null; updatedAt: string | null };

const agentIcons = { analyst: Search, developer: Code2, reviewer: ShieldCheck, tester: FlaskConical };
const modelOptions = [
  { id: "gpt-6.1-terra", label: "GPT-6.1 Terra · balanced" },
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol · deeper reasoning" },
  { id: "gpt-6-luna", label: "GPT-6 Luna · low cost" },
  { id: "gpt-6-astra", label: "GPT-6 Astra · flagship" },
];

function dollars(micros: number) { return `$${(micros / 1_000_000).toFixed(2)}`; }
function timeAgo(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

async function readApiResponse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.text();
  if (!body.trim()) throw new Error(`${fallback} (HTTP ${response.status}: empty response).`);
  let result: T & { error?: string };
  try { result = JSON.parse(body) as T & { error?: string }; }
  catch { throw new Error(response.ok ? `The server returned invalid JSON (HTTP ${response.status}).` : `${fallback} (HTTP ${response.status}).`); }
  if (!response.ok) throw new Error(result.error || `${fallback} (HTTP ${response.status}).`);
  return result;
}

export function AgentCenter({ workspaceId, repository }: { workspaceId: string; repository: string }) {
  const [data, setData] = useState<AgentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [configAgent, setConfigAgent] = useState<Agent | null>(null);
  const [activityAgent, setActivityAgent] = useState<Agent | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("gpt-6.1-terra");
  const [budget, setBudget] = useState(15);
  const [skills, setSkills] = useState<string[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [configError, setConfigError] = useState("");
  const [scanningAgentId, setScanningAgentId] = useState<string | null>(null);
  const [runAgent, setRunAgent] = useState<Agent | null>(null);
  const [runTask, setRunTask] = useState("");
  const [runOutput, setRunOutput] = useState("");
  const [runError, setRunError] = useState("");
  const [running, setRunning] = useState(false);
  const [trustConnection, setTrustConnection] = useState<SwitchTrustConnection>({ connected: false, instanceUrl: null, updatedAt: null });
  const [trustApiKey, setTrustApiKey] = useState("");
  const [trustInstanceUrl, setTrustInstanceUrl] = useState("https://app.switchagents.ai");
  const [trustSaving, setTrustSaving] = useState(false);
  const [trustMessage, setTrustMessage] = useState("");
  const [trustError, setTrustError] = useState("");

  const pollSwitchTrustScan = useCallback(async (scanId: string, agentId: string) => {
    const deadline = Date.now() + 5 * 60_000;
    try {
      while (Date.now() < deadline) {
        const response = await fetch(`/api/integrations/switch-trust/scans/${encodeURIComponent(scanId)}`, { cache: "no-store" });
        const result = await readApiResponse<{ scan: TrustScan }>(response, "Could not load Switch Trust scan status.");
        const scan = result.scan as TrustScan;
        setData((current) => current ? { ...current, trustScore: scan.score ?? current.trustScore, trustScan: scan, agents: current.agents.map((agent) => agent.id === scan.agentId ? { ...agent, trustScore: scan.score } : agent) } : current);
        if (["succeeded", "failed", "cancelled"].includes(scan.status)) {
          if (scan.status !== "succeeded") setPageError(scan.error || "Switch Trust evaluation failed.");
          setScanningAgentId(null);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      setPageError("The Switch Trust evaluation is still running. Its result will appear when it finishes.");
    } catch (cause) { setPageError(cause instanceof Error ? cause.message : "Trust scan failed."); }
    finally { setScanningAgentId((current) => current === agentId ? null : current); }
  }, []);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    setPageError("");
    try {
      const response = await fetch(`/api/agents?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
      const result = await readApiResponse<AgentData>(response, "Could not load your AI team.");
      setData(result);
      if (result.trustScan && ["queued", "running"].includes(result.trustScan.status)) {
        setScanningAgentId(result.trustScan.agentId);
        void pollSwitchTrustScan(result.trustScan.id, result.trustScan.agentId);
      }
    } catch (cause) {
      setPageError(cause instanceof Error ? cause.message : "Could not load your AI team.");
    } finally { setLoading(false); }
  }, [workspaceId, pollSwitchTrustScan]);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  const loadTrustConnection = useCallback(async () => {
    try {
      const response = await fetch("/api/integrations/switch-trust", { cache: "no-store" });
      const result = await readApiResponse<SwitchTrustConnection>(response, "Could not load Switch Trust connection status.");
      if (response.ok) {
        setTrustConnection(result);
        if (result.instanceUrl) setTrustInstanceUrl(result.instanceUrl);
      }
    } catch { /* The agent page remains usable while integration status is unavailable. */ }
  }, []);

  useEffect(() => { loadTrustConnection(); }, [loadTrustConnection]);

  async function saveSwitchTrustConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTrustSaving(true); setTrustError(""); setTrustMessage("");
    try {
      const response = await fetch("/api/integrations/switch-trust", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: trustApiKey, instanceUrl: trustInstanceUrl, workspaceId }),
      });
      const result = await readApiResponse<{ instanceUrl: string; initialScan: { id: string } | null; scanError?: string | null }>(response, "Could not save the Switch Trust key.");
      setTrustApiKey("");
      setTrustConnection({ connected: true, instanceUrl: result.instanceUrl, updatedAt: new Date().toISOString() });
      setTrustMessage(result.initialScan ? "API key saved securely. Your first Switch Trust evaluation is queued." : "API key saved securely for your account.");
      if (result.scanError) setTrustError(result.scanError);
      if (result.initialScan?.id) {
        const agent = data?.agents.find((item) => item.slug === "developer");
        if (agent) setScanningAgentId(agent.id);
        void pollSwitchTrustScan(result.initialScan.id, agent?.id ?? "");
      }
    } catch (cause) { setTrustError(cause instanceof Error ? cause.message : "Could not save the Switch Trust key."); }
    finally { setTrustSaving(false); }
  }

  async function removeSwitchTrustConnection() {
    setTrustSaving(true); setTrustError(""); setTrustMessage("");
    try {
      const response = await fetch("/api/integrations/switch-trust", { method: "DELETE" });
      await readApiResponse<{ connected: boolean }>(response, "Could not remove the Switch Trust connection.");
      setTrustConnection({ connected: false, instanceUrl: null, updatedAt: null });
      setTrustMessage("Switch Trust was disconnected.");
    } catch (cause) { setTrustError(cause instanceof Error ? cause.message : "Could not remove the Switch Trust connection."); }
    finally { setTrustSaving(false); }
  }

  function configure(agent: Agent) {
    setConfigAgent(agent);
    setInstructions(agent.instructions);
    setDescription(agent.description);
    setModel(agent.model);
    setBudget(agent.budgetCents / 100);
    setSkills([...agent.skills]);
    setTools([...agent.tools]);
    setConfigError("");
  }

  async function saveConfiguration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configAgent) return;
    setSaving(true); setConfigError("");
    try {
      const response = await fetch("/api/agents", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, agentId: configAgent.id, instructions, description, model, budgetCents: Math.round(Number(budget) * 100), skills, tools }),
      });
      await readApiResponse<Agent>(response, "Could not save this agent.");
      setConfigAgent(null);
      await loadAgents();
    } catch (cause) { setConfigError(cause instanceof Error ? cause.message : "Could not save this agent."); }
    finally { setSaving(false); }
  }

  async function viewActivity(agent: Agent) {
    setActivityAgent(agent); setActivities([]); setActivityLoading(true);
    try {
      const response = await fetch(`/api/agents/activity?workspaceId=${encodeURIComponent(workspaceId)}&agentId=${encodeURIComponent(agent.id)}`, { cache: "no-store" });
      const result = await readApiResponse<ActivityItem[]>(response, "Could not load activity.");
      setActivities(result);
    } catch (cause) { setPageError(cause instanceof Error ? cause.message : "Could not load activity."); }
    finally { setActivityLoading(false); }
  }

  async function scanAgent(agentId: string) {
    setScanningAgentId(agentId); setPageError("");
    try {
      const response = await fetch("/api/integrations/switch-trust/scans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, agentId }) });
      const result = await readApiResponse<{ scan: { id: string } }>(response, "Could not queue the Switch Trust evaluation.");
      await pollSwitchTrustScan(result.scan.id, agentId);
    } catch (cause) { setPageError(cause instanceof Error ? cause.message : "Could not start the Switch Trust evaluation."); setScanningAgentId(null); }
  }

  async function submitRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!runAgent) return;
    setRunning(true); setRunError(""); setRunOutput("");
    try {
      const response = await fetch("/api/agents/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, agentId: runAgent.id, task: runTask }) });
      const result = await readApiResponse<{ output?: string }>(response, "The agent could not complete this run.");
      setRunOutput(result.output || "The agent returned no text output.");
      await loadAgents();
    } catch (cause) { setRunError(cause instanceof Error ? cause.message : "The agent could not complete this run."); }
    finally { setRunning(false); }
  }

  const enabledCount = data?.agents.filter((agent) => agent.enabled).length ?? 0;
  const toolsCatalog = data?.tools ?? [];

  return <section className="agent-center">
    <div className="agent-page-heading"><div><span className="setup-step">THE PEOPLE BEHIND THE PROGRESS</span><h1>AI Team</h1><p>Specialists for {repository}. Thoughtfully set up, ready when you are.</p></div><span className={`openai-connection ${data?.openAIConfigured ? "connected" : "needs-key"}`}><i />{data?.openAIConfigured ? "OpenAI connected" : "OpenAI setup needed"}</span></div>
    {!data?.openAIConfigured && !loading && <div className="openai-setup-notice"><span><Sparkles size={17} /></span><div><b>Connect OpenAI to activate your agents</b><small>Add <code>OPENAI_API_KEY</code> to the server environment. The team and its configurations are ready in the meantime.</small></div><span className="setup-badge">SETUP</span></div>}
    <section className={`switch-trust-connect-panel ${trustConnection.connected ? "is-connected" : ""}`} aria-labelledby="switch-trust-connect-title">
      <div className="switch-trust-connect-heading"><span className="switch-trust-connect-icon"><KeyRound size={17} /></span><div><span className="summary-label">TRUST &amp; ROI INTEGRATION</span><h2 id="switch-trust-connect-title">Connect Switch Trust</h2><p>{trustConnection.connected ? "Your Switch Trust API key is saved securely to your account." : "Add your personal Switch Trust API key to enable trust and ROI data."}</p></div><span className={`switch-trust-state ${trustConnection.connected ? "connected" : "not-connected"}`}><i />{trustConnection.connected ? "Key saved" : "Not connected"}</span></div>
      {trustConnection.connected ? <div className="switch-trust-connected-row"><span><Link2 size={13} />{trustConnection.instanceUrl}</span><button type="button" onClick={removeSwitchTrustConnection} disabled={trustSaving}>{trustSaving ? <LoaderCircle className="loading-icon" size={13} /> : <X size={13} />} Disconnect</button></div> : <form className="switch-trust-connect-form" onSubmit={saveSwitchTrustConnection}><label>Switch Trust API key<input type="password" value={trustApiKey} onChange={(event) => setTrustApiKey(event.target.value)} autoComplete="new-password" placeholder="Paste your Switch Trust API key" minLength={12} maxLength={512} required /></label><label>Instance URL<input type="url" value={trustInstanceUrl} onChange={(event) => setTrustInstanceUrl(event.target.value)} placeholder="https://app.switchagents.ai" required /></label><button type="submit" className="switch-trust-save-button" disabled={trustSaving || !trustApiKey.trim()}>{trustSaving ? <LoaderCircle className="loading-icon" size={14} /> : <Link2 size={14} />}{trustSaving ? "Saving securely…" : "Connect Switch Trust"}</button></form>}
      {trustError && <p className="switch-trust-form-error" role="alert">{trustError}</p>}{trustMessage && <p className="switch-trust-form-success" role="status">{trustMessage}</p>}
      <small className="switch-trust-key-note">Your key is encrypted before it is stored and is never shown again. Use an Editor-scoped key to read ROI data and manage evaluations.</small>
    </section>
    {pageError && <div className="agent-page-error" role="alert">{pageError}<button type="button" onClick={() => setPageError("")} aria-label="Dismiss"><X size={14} /></button></div>}
    <div className="agent-stats-grid">
      <article className="agent-stat-card stat-agents"><span className="agent-stat-icon"><Bot size={19} /></span><span className="agent-stat-overline">YOUR CREW</span><strong>{loading ? "—" : `${enabledCount}/4`}</strong><span className="agent-stat-caption">Active Agents <i>Ready to collaborate</i></span><span className="stat-decoration decoration-purple" /></article>
      <article className="agent-stat-card stat-trust"><span className="agent-stat-icon"><ShieldCheck size={19} /></span><span className="agent-stat-overline">LATEST EVALUATION</span><strong>{loading ? "—" : data?.trustScore == null ? "—" : `${data.trustScore}`}<small>/100</small></strong><span className="agent-stat-caption">Switch Trust Score <i>{data?.trustScan ? `${data.agents.find((agent) => agent.id === data.trustScan?.agentId)?.name ?? "Agent"} · ${data.trustScan.status} · ${timeAgo(data.trustScan.createdAt)}` : trustConnection.connected ? "Ready to scan" : "Connect Switch Trust"}</i></span><button className="scan-again-button" type="button" onClick={() => { const agent = data?.agents.find((item) => item.slug === "developer") ?? data?.agents[0]; if (agent) void scanAgent(agent.id); }} disabled={Boolean(scanningAgentId) || loading || !trustConnection.connected || !data?.agents.length}>{scanningAgentId ? <LoaderCircle className="loading-icon" size={13} /> : <Sparkles size={13} />}{scanningAgentId ? "Scanning" : "SwitchAgent Scan"}</button><span className="stat-decoration decoration-blue" />
        {data?.trustScan?.report && (data.trustScan.report.findings?.length || data.trustScan.report.roi?.length) ? <div className="trust-check-popover"><strong>{data.trustScan.report.summary}</strong>{data.trustScan.report.findings?.map((finding, index) => <span key={`${finding.label}-${index}`}><i className={finding.status === "passed" || finding.status === "scored" ? "passed" : "failed"}>{finding.score == null ? <Activity size={10} /> : <Check size={10} />}</i>{finding.label}{finding.score == null ? "" : ` · ${finding.score}/100`}</span>)}{data.trustScan.report.roi?.map((item) => <span key={item.analysisType}><i className="passed"><CircleDollarSign size={10} /></i>ROI · {item.analysisType.replaceAll("_", " ")} · ${item.estimatedSavingsUsd.toFixed(2)} potential savings</span>)}</div> : data?.trustScan?.error ? <div className="trust-check-popover"><span>{data.trustScan.error}</span></div> : null}
      </article>
      <article className="agent-stat-card stat-spend"><span className="agent-stat-icon"><CircleDollarSign size={19} /></span><span className="agent-stat-overline">THIS MONTH</span><strong>{loading ? "—" : dollars(data?.monthlySpendMicros ?? 0)}</strong><span className="agent-stat-caption">Monthly Spending <i>Estimated model token usage</i></span><span className="stat-decoration decoration-mint" /></article>
    </div>

    <div className="agent-section-heading"><div><span className="summary-label">SPECIALISTS</span><h2>Meet your agents</h2><p>Focused roles, shared context, clear budgets.</p></div><span className="agent-team-count"><span>{enabledCount}</span> agents ready</span></div>
    {loading ? <div className="agent-loading"><LoaderCircle className="loading-icon" size={22} />Preparing your team…</div> : <div className="agent-card-grid">{data?.agents.map((agent) => {
      const Icon = agentIcons[agent.slug as keyof typeof agentIcons] ?? Bot;
      const spent = agent.usage.spendMicros;
      const budgetMicros = agent.budgetCents * 10_000;
      const percent = budgetMicros > 0 ? Math.min(100, spent / budgetMicros * 100) : 0;
      return <article className={`agent-card agent-${agent.slug}`} key={agent.id}>
        <div className="agent-card-top"><span className={`agent-avatar avatar-${agent.slug}`}><Icon size={20} strokeWidth={1.8} /></span><span className={`agent-status ${agent.enabled ? data?.openAIConfigured ? "ready" : "needs-setup" : "paused"}`}><i />{agent.enabled ? data?.openAIConfigured ? "Ready" : "Needs setup" : "Paused"}</span><button className="agent-card-more" type="button" aria-label={`Configure ${agent.name}`} onClick={() => configure(agent)}>···</button></div>
        <div className="agent-card-title"><div><h3>{agent.name}</h3><span>{agent.role}</span></div><span className={`agent-role-chip role-${agent.slug}`}>{agent.slug === "analyst" ? "THINK" : agent.slug === "developer" ? "BUILD" : agent.slug === "reviewer" ? "REVIEW" : "VERIFY"}</span></div>
        <p className="agent-description">{agent.description}</p>
        <div className="agent-card-model"><span>MODEL</span><b>{agent.model.replace("gpt-", "GPT-")}</b></div>
        <div className="agent-card-trust"><span>SWITCH TRUST SCORE</span><b>{agent.trustScore == null ? "Not scanned" : `${agent.trustScore}/100`}</b></div>
        <div className="agent-budget-block"><div className="agent-budget-row"><span><CircleDollarSign size={13} /> Monthly budget</span><b>{dollars(spent)} <small>/ {(agent.budgetCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}</small></b></div><div className="agent-budget-track"><span style={{ width: `${percent}%` }} /></div><small className="agent-budget-usage">{percent.toFixed(0)}% used · {agent.usage.calls} runs this month</small></div>
        <div className="agent-tools"><span className="agent-mini-label">TOOLS</span><div>{agent.tools.map((toolId) => { const tool = toolsCatalog.find((item) => item.id === toolId); return <span className="agent-tool-chip" key={toolId} title={tool?.description}>{tool?.label ?? toolId}</span>; })}</div></div>
        <div className="agent-card-actions"><button type="button" className="agent-configure-button" onClick={() => configure(agent)}>Configure <ChevronRight size={14} /></button><button type="button" className="agent-scan-card-button" onClick={() => void scanAgent(agent.id)} disabled={Boolean(scanningAgentId) || !trustConnection.connected} title={!trustConnection.connected ? "Connect Switch Trust to scan this agent" : `Run a Switch Trust evaluation for ${agent.name}`}><Sparkles size={12} />{scanningAgentId === agent.id ? "Scanning" : "SwitchAgent Scan"}</button><button type="button" className="agent-run-card-button" onClick={() => { setRunAgent(agent); setRunTask(""); setRunOutput(""); setRunError(""); }} disabled={!data?.openAIConfigured || !agent.enabled} title={!data?.openAIConfigured ? "Add OPENAI_API_KEY to enable agent runs" : "Run this agent"}><ArrowUpRight size={13} /> Run</button><button type="button" className="agent-activity-button" onClick={() => viewActivity(agent)}><Activity size={14} /> View activity</button></div>
      </article>;
    })}</div>}

    <section className="agent-spending-panel"><header><span className="spend-panel-icon"><CircleDollarSign size={17} /></span><div><span className="summary-label">BUDGET OVERVIEW</span><h2>Spending details</h2></div><span className="spend-period">Monthly</span></header><div className="spend-agent-rows">{data?.agents.map((agent) => { const percent = agent.budgetCents ? Math.min(100, agent.usage.spendMicros / (agent.budgetCents * 10_000) * 100) : 0; return <div className="spend-agent-row" key={agent.id}><span className={`spend-agent-dot dot-${agent.slug}`} /><b>{agent.name}</b><div className="spend-row-track"><span style={{ width: `${percent}%` }} /></div><span className="spend-row-amount">{dollars(agent.usage.spendMicros)} <small>/ {dollars(agent.budgetCents * 10_000)}</small></span></div>; })}</div><p className="spend-disclaimer">Token-based estimate from agent runs. OpenAI tool-call charges may be billed separately.</p></section>

    <section className="live-office-card"><div className="live-office-copy"><span className="summary-label">COMING SOON</span><h2>Live Agent Office</h2><p>A shared visual workspace where you’ll see your specialists think, collaborate, and ship.</p><span className="office-coming-tag"><LockKeyhole size={12} /> Workspace preview is being designed</span></div><div className="live-office-art"><div className="live-office-stars"><i /><i /><i /></div><div className="live-office-ring ring-outer" /><div className="live-office-ring ring-inner" /><div className="office-avatar orb-analyst"><Search size={16} /></div><div className="office-avatar orb-developer"><Code2 size={16} /></div><div className="office-avatar orb-reviewer"><ShieldCheck size={16} /></div><div className="office-avatar orb-tester"><FlaskConical size={16} /></div><div className="office-core"><Bot size={28} /></div><span className="orbit-caption">FOUR MINDS · ONE MISSION</span></div></section>

    {configAgent && <div className="agent-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setConfigAgent(null); }}><section className="agent-config-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-config-title"><header className="agent-dialog-header"><div><span className="summary-label">SPECIALIST SETTINGS</span><h2 id="agent-config-title">Configure {configAgent.name}</h2><p>Set the role, working context, tools, and monthly guardrails.</p></div><button type="button" className="agent-dialog-close" onClick={() => setConfigAgent(null)} aria-label="Close" disabled={saving}><X size={18} /></button></header>
      <form className="agent-config-form" onSubmit={saveConfiguration}><label>Short description<input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} required /></label><label>Instructions<textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={6} minLength={40} maxLength={8000} required /><small>These instructions are sent to OpenAI as this specialist’s system guidance.</small></label>
        <div className="agent-config-row"><label>OpenAI model<select value={model} onChange={(event) => setModel(event.target.value)}>{modelOptions.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label><label>Monthly budget (USD)<span className="budget-input-wrap"><span>$</span><input type="number" min="1" max="10000" step="1" value={budget} onChange={(event) => setBudget(Number(event.target.value))} required /></span></label></div>
        <fieldset className="agent-config-fieldset"><legend>Attached skills <small>Default skills included</small></legend><div className="config-chip-list">{configAgent.skills.length ? configAgent.skills.map((skill) => <button type="button" className="config-skill-chip selected" key={skill} onClick={() => setSkills((current) => current.includes(skill) ? current.filter((item) => item !== skill) : [...current, skill])}><Check size={12} />{skill}</button>) : <span className="no-skills">No skills attached.</span>}</div></fieldset>
        <fieldset className="agent-config-fieldset"><legend>OpenAI tools <small>Connected tools are enabled for this agent</small></legend><div className="config-tool-grid">{toolsCatalog.map((tool) => { const isAvailable = data?.availableTools.includes(tool.id) ?? false; const selected = tools.includes(tool.id); return <button type="button" key={tool.id} className={`config-tool-chip ${selected ? "selected" : ""} ${!isAvailable ? "unavailable" : ""}`} disabled={!isAvailable} onClick={() => setTools((current) => current.includes(tool.id) ? current.filter((item) => item !== tool.id) : [...current, tool.id])}><span className="tool-chip-check">{selected ? <Check size={11} /> : !isAvailable ? <LockKeyhole size={10} /> : null}</span><span><b>{tool.label}</b><small>{!isAvailable ? tool.state === "vector-store" ? "Connect a vector store" : tool.state === "runtime" ? "Runtime not connected" : "No server connected" : tool.description}</small></span></button>; })}</div></fieldset>
        {configError && <p className="agent-dialog-error" role="alert">{configError}</p>}
        <footer className="agent-dialog-actions"><button type="button" className="agent-cancel-button" onClick={() => setConfigAgent(null)} disabled={saving}>Cancel</button><button type="submit" className="agent-save-button" disabled={saving}>{saving ? <LoaderCircle className="loading-icon" size={15} /> : <Check size={15} />}{saving ? "Saving…" : "Save configuration"}</button></footer>
      </form>
    </section></div>}

    {runAgent && <div className="agent-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !running) setRunAgent(null); }}><section className="agent-config-dialog agent-run-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-run-title"><header className="agent-dialog-header"><div><span className="summary-label">START A SPECIALIST RUN</span><h2 id="agent-run-title">Send a task to {runAgent.name}</h2><p>The agent will use its saved instructions, selected tools, and workspace context.</p></div><button type="button" className="agent-dialog-close" onClick={() => setRunAgent(null)} aria-label="Close" disabled={running}><X size={18} /></button></header><form className="agent-config-form" onSubmit={submitRun}><label>What should {runAgent.name} work on?<textarea value={runTask} onChange={(event) => setRunTask(event.target.value)} rows={5} maxLength={6000} minLength={3} placeholder="Describe the task, question, or review you need…" required /><small>The connected repository is not mounted into the model runtime, so runs can analyze provided context but cannot edit project files.</small></label>{runError && <p className="agent-dialog-error" role="alert">{runError}</p>}{runOutput && <article className="agent-run-output"><span className="summary-label">AGENT RESPONSE</span><p>{runOutput}</p></article>}<footer className="agent-dialog-actions"><button type="button" className="agent-cancel-button" onClick={() => setRunAgent(null)} disabled={running}>Close</button><button type="submit" className="agent-save-button" disabled={running || !runTask.trim()}>{running ? <LoaderCircle className="loading-icon" size={15} /> : <ArrowUpRight size={15} />}{running ? "Working…" : "Start run"}</button></footer></form></section></div>}

    {activityAgent && <div className="agent-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setActivityAgent(null); }}><aside className="agent-activity-drawer" role="dialog" aria-modal="true" aria-labelledby="activity-drawer-title"><header><span className="drawer-agent-avatar"><Bot size={18} /></span><div><span className="summary-label">AGENT TIMELINE</span><h2 id="activity-drawer-title">{activityAgent.name} activity</h2></div><button type="button" onClick={() => setActivityAgent(null)} aria-label="Close activity"><X size={18} /></button></header><p className="drawer-agent-description">{activityAgent.description}</p><div className="activity-drawer-list">{activityLoading ? <div className="agent-loading"><LoaderCircle className="loading-icon" size={20} />Loading activity…</div> : activities.length ? activities.map((item) => <article className="agent-activity-item" key={item.id}><span className={`activity-kind-marker ${item.kind}`}><Activity size={14} /></span><div><b>{item.title}</b><p>{item.details || "Configuration updated."}</p><footer><span><Clock3 size={11} />{timeAgo(item.createdAt)}</span>{item.kind === "run" && <span>{item.inputTokens + item.outputTokens} tokens · {dollars(item.costMicros)}</span>}</footer></div></article>) : <div className="activity-empty"><span><Activity size={20} /></span><b>No activity yet</b><p>Agent runs and configuration changes will show up here.</p></div>}</div><footer className="drawer-budget-footer"><span>Month-to-date spend</span><b>{dollars(activityAgent.usage.spendMicros)} <small>/ {dollars(activityAgent.budgetCents * 10_000)}</small></b></footer></aside></div>}
  </section>;
}
