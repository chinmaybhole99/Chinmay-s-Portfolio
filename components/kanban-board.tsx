"use client";

import { useCallback, useEffect, useState, type DragEvent, type FormEvent } from "react";
import { AlertCircle, Bug, CalendarDays, Check, CircleDot, Flag, GitBranch, LoaderCircle, Play, Plus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";

type IssueType = "Issue" | "Bug" | "Feature";
type Priority = "Low" | "Medium" | "High";
type Stage = "Todo" | "In Development" | "In Review" | "Testing" | "Done/PR Ready";
type Issue = { id: string; title: string; description: string; type: IssueType; priority: Priority; stage: Stage; assignee: string; due: string; url: string; isRunning?: boolean };

const stages: { name: Stage; color: string; icon: string }[] = [
  { name: "Todo", color: "violet", icon: "✳" },
  { name: "In Development", color: "blue", icon: "◈" },
  { name: "In Review", color: "amber", icon: "⌕" },
  { name: "Testing", color: "coral", icon: "◉" },
  { name: "Done/PR Ready", color: "mint", icon: "✓" },
];

function TypeIcon({ type }: { type: IssueType }) {
  if (type === "Bug") return <Bug size={13} />;
  if (type === "Feature") return <Sparkles size={13} />;
  return <CircleDot size={13} />;
}

export function KanbanBoard({ repository, userName, workspaceId }: { repository: string; userName: string; workspaceId: string }) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newIssueStage, setNewIssueStage] = useState<Stage>("Todo");
  const [editingIssueId, setEditingIssueId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<Stage | null>(null);
  const [openMenuIssueId, setOpenMenuIssueId] = useState<string | null>(null);

  const refreshIssues = useCallback(async () => {
    setRefreshing(true);
    setActionError("");
    try {
      let cached: Issue[] = [];
      try {
        const parsed = JSON.parse(window.localStorage.getItem(`devcrew:board:${workspaceId}`) ?? "[]");
        if (Array.isArray(parsed)) cached = parsed.filter((issue): issue is Issue => typeof issue?.id === "string" && /^\d+$/.test(issue.id));
      } catch { /* Ignore stale or invalid cached board data. */ }
      const response = await fetch(`/api/github/issues?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load GitHub issues.");
      setIssues((current) => {
        const previous = new Map([...cached, ...current].map((issue) => [issue.id, issue]));
        return (result as Issue[]).map((issue) => {
          const old = previous.get(issue.id);
          return {
            ...issue,
            type: old?.type ?? issue.type,
            priority: old?.priority ?? issue.priority,
            stage: old?.stage ?? issue.stage,
            isRunning: old?.isRunning ?? false,
          };
        });
      });
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not load GitHub issues.");
    } finally {
      setRefreshing(false);
      setLoading(false);
      setStorageReady(true);
    }
  }, [workspaceId]);

  useEffect(() => {
    setIssues([]);
    setLoading(true);
    setStorageReady(false);
    refreshIssues();
  }, [refreshIssues]);

  useEffect(() => {
    if (storageReady) window.localStorage.setItem(`devcrew:board:${workspaceId}`, JSON.stringify(issues));
  }, [issues, storageReady, workspaceId]);

  function openCreateDialog(stage: Stage = "Todo") {
    setEditingIssueId(null);
    setNewIssueStage(stage);
    setDialogError("");
    setDialogOpen(true);
  }

  function openIssueDialog(issue: Issue) {
    setEditingIssueId(issue.id);
    setNewIssueStage(issue.stage);
    setDialogError("");
    setDialogOpen(true);
  }

  function startDrag(event: DragEvent<HTMLElement>, issueId: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", issueId);
    setDragging(issueId);
  }

  function moveIssue(event: DragEvent<HTMLElement>, stage: Stage) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(stage);
  }

  function dropIssue(event: DragEvent<HTMLElement>, stage: Stage) {
    event.preventDefault();
    const issueId = event.dataTransfer.getData("text/plain");
    if (issueId) setIssues((current) => current.map((issue) => issue.id === issueId ? { ...issue, stage } : issue));
    setDragging(null);
    setDropTarget(null);
  }

  async function runIssue(issueId: string) {
    setActionError("");
    try {
      const response = await fetch("/api/github/issues", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "run", workspaceId, issueNumber: Number(issueId) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "GitHub could not assign this issue.");
      setIssues((current) => current.map((issue) => issue.id === issueId
        ? { ...issue, stage: "In Development", assignee: result.assignee || userName, isRunning: true }
        : issue));
      setOpenMenuIssueId(null);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "GitHub could not assign this issue.");
    }
  }

  async function deleteIssue(issueId: string) {
    if (!window.confirm("Close this GitHub issue? It will be removed from the open board.")) return;
    setActionError("");
    try {
      const response = await fetch("/api/github/issues", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "close", workspaceId, issueNumber: Number(issueId) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "GitHub could not close this issue.");
      setIssues((current) => current.filter((issue) => issue.id !== issueId));
      setOpenMenuIssueId(null);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "GitHub could not close this issue.");
    }
  }

  async function createIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const title = String(values.get("title") ?? "").trim();
    if (!title) return;
    const details = {
      title,
      description: String(values.get("description") ?? "").trim(),
      type: String(values.get("type") ?? "Issue") as IssueType,
      priority: String(values.get("priority") ?? "Medium") as Priority,
      stage: String(values.get("stage") ?? "Todo") as Stage,
      due: String(values.get("due") ?? "") || "No due date",
    };
    setSaving(true);
    setDialogError("");
    try {
      const response = await fetch("/api/github/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: editingIssueId ? "update" : "create", workspaceId, issueNumber: editingIssueId ? Number(editingIssueId) : undefined, title, description: details.description }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save this GitHub issue.");
      const savedIssue: Issue = {
        ...result,
        ...details,
        assignee: result.assignee || (editingIssueId ? issues.find((issue) => issue.id === editingIssueId)?.assignee : "Unassigned") || "Unassigned",
        isRunning: editingIssueId ? issues.find((issue) => issue.id === editingIssueId)?.isRunning : false,
      };
      if (editingIssueId) setIssues((current) => current.map((issue) => issue.id === editingIssueId ? savedIssue : issue));
      else setIssues((current) => [savedIssue, ...current]);
      setDialogOpen(false);
      form.reset();
    } catch (cause) {
      setDialogError(cause instanceof Error ? cause.message : "Could not save this GitHub issue.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="kanban-page" onClick={(event) => { if (!(event.target as HTMLElement).closest(".issue-actions-wrap")) setOpenMenuIssueId(null); }}>
    <div className="kanban-heading"><div><span className="setup-step">PROJECT WORKFLOW</span><h1>Kanban board</h1><p>Move work forward, one small step at a time.</p></div><button type="button" className="create-issue-button" onClick={() => openCreateDialog()}><Plus size={17} /> Create issue</button></div>
    <div className="kanban-toolbar"><span className="board-repository"><GitBranch size={14} />{repository}</span><span className="drag-hint">Grab a card and drop it into another column</span><div className="board-toolbar-actions"><span className="board-card-count">{issues.length} open issues</span><button type="button" className="refresh-issues-button" onClick={refreshIssues} disabled={refreshing}><RefreshCw size={14} className={refreshing ? "refresh-spinning" : ""} />Refresh</button></div></div>
    {actionError && <p className="kanban-error" role="alert"><AlertCircle size={15} />{actionError}<button type="button" onClick={() => setActionError("")} aria-label="Dismiss error"><X size={14} /></button></p>}
    <div className="kanban-scroll"><div className="kanban-columns">{stages.map((stage) => {
      const columnIssues = issues.filter((issue) => issue.stage === stage.name);
      return <section key={stage.name} className={`kanban-column column-${stage.color} ${dropTarget === stage.name ? "drop-active" : ""}`} onDragOver={(event) => moveIssue(event, stage.name)} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(null); }} onDrop={(event) => dropIssue(event, stage.name)} aria-label={`${stage.name} column`}>
        <header className="kanban-column-header"><div className="column-title-wrap"><span className="column-glyph">{stage.icon}</span><h2>{stage.name}</h2><span className="column-count">{columnIssues.length}</span></div><button type="button" className="column-add" onClick={() => openCreateDialog(stage.name)} aria-label={`Add issue to ${stage.name}`}><Plus size={15} /></button></header>
        <div className="kanban-card-list">{columnIssues.length ? columnIssues.map((issue) => <article key={issue.id} draggable tabIndex={0} role="button" aria-label={`Open details for issue #${issue.id}: ${issue.title}`} onClick={() => openIssueDialog(issue)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openIssueDialog(issue); } }} onDragStart={(event) => startDrag(event, issue.id)} onDragEnd={() => { setDragging(null); setDropTarget(null); }} className={`issue-card ${dragging === issue.id ? "is-dragging" : ""}`}>
          <div className="issue-card-top"><span className={`issue-type type-${issue.type.toLowerCase()}`}><TypeIcon type={issue.type} />{issue.type}</span><div className="issue-actions-wrap"><button className={`issue-run-button ${issue.isRunning ? "is-running" : ""}`} type="button" title={issue.isRunning ? "Assigned and in progress" : `Run and assign to ${userName}`} aria-label={issue.isRunning ? `Assigned to ${userName} and in progress` : `Run and assign ${issue.id} to ${userName}`} onClick={(event) => { event.stopPropagation(); runIssue(issue.id); }}>{issue.isRunning ? <Check size={13} /> : <Play size={12} fill="currentColor" />}</button><button className="issue-more" type="button" aria-label={`Actions for ${issue.id}`} aria-expanded={openMenuIssueId === issue.id} onClick={(event) => { event.stopPropagation(); setOpenMenuIssueId(openMenuIssueId === issue.id ? null : issue.id); }}>•••</button>{openMenuIssueId === issue.id && <div className="issue-action-menu" onClick={(event) => event.stopPropagation()}><button type="button" className="issue-menu-run" onClick={() => runIssue(issue.id)} disabled={issue.isRunning}><Play size={13} fill="currentColor" />{issue.isRunning ? "Running" : "Run"}</button><button type="button" className="issue-menu-delete" onClick={() => deleteIssue(issue.id)}><Trash2 size={13} />Delete</button></div>}</div></div>
          <span className="issue-id"><a href={issue.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} title="Open on GitHub">#{issue.id}</a></span><h3>{issue.title}</h3>
          <div className="issue-card-footer"><span className={`priority priority-${issue.priority.toLowerCase()}`}><Flag size={11} />{issue.priority}</span><span className={`issue-assignee ${issue.isRunning ? "assigned-to-you" : ""}`} title={issue.assignee}>{issue.assignee.slice(0, 1).toUpperCase()}</span>{issue.isRunning && <span className="running-label">Working</span>}<span className="issue-due"><CalendarDays size={11} />{issue.due}</span></div>
        </article>) : <div className="column-empty"><span>{stage.icon}</span><small>{loading ? "Loading GitHub issues…" : issues.length ? "Drop an issue here" : "No open issues"}</small></div>}</div>
      </section>;
    })}</div></div>
    {dialogOpen && <IssueDialog issue={issues.find((issue) => issue.id === editingIssueId)} initialStage={newIssueStage} repository={repository} error={dialogError} saving={saving} onClose={() => setDialogOpen(false)} onSubmit={createIssue} />}
  </section>;
}

function IssueDialog({ issue, initialStage, repository, error, saving, onClose, onSubmit }: { issue?: Issue; initialStage: Stage; repository: string; error: string; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void> }) {
  return <div className="issue-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="issue-dialog" role="dialog" aria-modal="true" aria-labelledby="issue-dialog-title"><header className="issue-dialog-header"><div><span className="setup-step">{issue ? issue.id : "MAKE IT HAPPEN"}</span><h2 id="issue-dialog-title">{issue ? "Issue details" : "Create an issue"}</h2><p>{issue ? "Update the details or move this work to another stage." : "Add the details so your team knows what to do next."}</p></div><button type="button" className="dialog-close" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></header>
    <form className="issue-form" onSubmit={onSubmit}><label>Title<input name="title" defaultValue={issue?.title ?? ""} placeholder="What needs to get done?" autoFocus maxLength={120} required /></label><label>Description<textarea name="description" defaultValue={issue?.description ?? ""} placeholder="Add a few details or acceptance criteria…" rows={3} /></label><div className="issue-form-row"><label>Type<select name="type" defaultValue={issue?.type ?? "Issue"}><option>Issue</option><option>Bug</option><option>Feature</option></select></label><label>Priority<select name="priority" defaultValue={issue?.priority ?? "Medium"}><option>Low</option><option>Medium</option><option>High</option></select></label></div><div className="issue-form-row last-row"><label>Status<select name="stage" defaultValue={issue?.stage ?? initialStage}>{stages.map((stage) => <option key={stage.name}>{stage.name}</option>)}</select></label><label>Due date<input name="due" defaultValue={issue?.due === "No due date" ? "" : issue?.due ?? ""} placeholder="e.g. Nov 12" maxLength={24} /></label></div><span className="dialog-repo"><GitBranch size={13} />{repository}</span>{error && <p className="issue-dialog-error" role="alert">{error}</p>}<footer className="issue-dialog-actions"><button type="button" className="cancel-issue" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="create-issue-button" disabled={saving}>{saving ? <LoaderCircle className="loading-icon" size={15} /> : issue ? <Check size={15} /> : <Plus size={16} />}{saving ? "Saving to GitHub…" : issue ? "Save changes" : "Create issue"}</button></footer></form>
  </section></div>;
}
