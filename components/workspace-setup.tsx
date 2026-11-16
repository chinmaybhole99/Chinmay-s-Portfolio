"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, ChevronDown, Github, ImagePlus, LoaderCircle, LockKeyhole, RefreshCw } from "lucide-react";
import { authClient } from "@/lib/auth-client";

type Repo = { name: string; url: string; isPrivate: boolean; description: string | null };
const icons = ["✳", "◈", "⬡", "✦", "◉", "⌘"];

export function WorkspaceSetup({ userName, githubConfigured }: { userName: string; githubConfigured: boolean }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(icons[0]);
  const [logo, setLogo] = useState("");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [repository, setRepository] = useState("");
  const [connected, setConnected] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/github/repos").then(async (response) => {
      if (!response.ok) return;
      const data = await response.json();
      if (active) { setRepos(data); setConnected(true); }
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function loadRepos() {
    setLoadingRepos(true);
    setError("");
    try {
      const response = await fetch("/api/github/repos");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load repositories.");
      setRepos(result);
      setConnected(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load repositories."); }
    finally { setLoadingRepos(false); }
  }

  async function connectGitHub() {
    setError("");
    try {
      const result = await authClient.linkSocial({ provider: "github", callbackURL: `${window.location.origin}/setup`, scopes: ["repo"] });
      if (result.error) setError(result.error.message || "Could not connect GitHub.");
    } catch { setError("Could not connect GitHub. Please try again."); }
  }

  async function saveWorkspace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selected = repos.find((repo) => repo.name === repository);
    if (!selected) { setError("Choose a repository to continue."); return; }
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, icon, logo, repository: selected.name, repositoryUrl: selected.url }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save your workspace.");
      router.push(`/dashboard?workspace=${result.id}`); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save your workspace."); setSaving(false); }
  }

  function uploadLogo(file?: File) {
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 1_000_000) { setError("Choose an image smaller than 1 MB."); return; }
    const reader = new FileReader(); reader.onload = () => setLogo(String(reader.result)); reader.readAsDataURL(file);
  }

  return <main className="setup-shell">
    <header className="setup-header"><a className="setup-brand" href="/"><span className="brand-mark" aria-hidden="true"><span /></span>devcrew</a><span className="setup-user">Setting up for {userName}</span></header>
    <div className="setup-layout">
      <aside className="setup-intro"><span className="setup-step">YOUR SPACE, YOUR RULES</span><h1>A home for the work you care about.</h1><p>Name your workspace, give it a mark, and connect the repository your AI crew will build with.</p><div className="setup-progress"><span className="progress-number">01</span><span><b>Workspace setup</b><small>A few details, then you’re in.</small></span></div></aside>
      <section className="setup-card"><div className="setup-card-heading"><span className="setup-step">GET STARTED</span><h2>Create your workspace</h2><p>You can change these details anytime.</p></div>
        <form className="setup-form" onSubmit={saveWorkspace}>
          <label className="setup-label">Workspace name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Acme Studio" maxLength={60} required /></label>
          <div className="setup-label">Workspace identity<div className="identity-picker"><button className="identity-preview" type="button" onClick={() => fileInput.current?.click()} aria-label="Upload a custom workspace logo">{logo ? <img src={logo} alt="" /> : <span>{icon}</span>}<i><ImagePlus size={13} /></i></button><input ref={fileInput} type="file" accept="image/*" hidden onChange={(event) => uploadLogo(event.target.files?.[0])} /><div className="icon-options" aria-label="Choose workspace icon">{icons.map((choice) => <button type="button" key={choice} aria-label={`Use ${choice} icon`} aria-pressed={!logo && icon === choice} className={icon === choice && !logo ? "icon-choice selected" : "icon-choice"} onClick={() => { setIcon(choice); setLogo(""); }}>{choice}</button>)}<button type="button" className="upload-logo" onClick={() => fileInput.current?.click()}><ImagePlus size={15} /> Upload logo</button></div></div></div>
          <div className="setup-label">GitHub repository<div className="github-connect-row">{!connected ? <><span className="github-lock"><Github size={17} /></span><span className="connect-copy"><b>{githubConfigured ? "Connect your GitHub account" : "GitHub sign-in is not configured"}</b><small>{githubConfigured ? "Choose a repository to attach to this workspace." : "Add GitHub OAuth credentials to enable repository access."}</small></span><button className="connect-button" type="button" onClick={connectGitHub} disabled={!githubConfigured}><Github size={15} /> Connect</button></> : <><span className="github-connected"><Check size={16} /></span><span className="connect-copy"><b>GitHub connected</b><small>Pick the repository your agents should work on.</small></span><button className="refresh-button" type="button" onClick={loadRepos} aria-label="Refresh repositories"><RefreshCw size={15} /></button></>}</div>
            {connected && <div className="repo-select-wrap"><select value={repository} onChange={(event) => setRepository(event.target.value)} required><option value="">Select a repository…</option>{repos.map((repo) => <option key={repo.name} value={repo.name}>{repo.name}{repo.isPrivate ? " · Private" : ""}</option>)}</select><ChevronDown size={16} /></div>}
            {!connected && githubConfigured && <button type="button" className="repo-retry" onClick={loadRepos} disabled={loadingRepos}>{loadingRepos ? <LoaderCircle className="loading-icon" size={14} /> : null}Already connected? Load repositories</button>}
          </div>
          {error && <p className="setup-error" role="alert">{error}</p>}
          <button className="setup-submit" type="submit" disabled={saving || !connected || !repository}>{saving ? <LoaderCircle className="loading-icon" size={17} /> : <>Create workspace <ArrowRight size={17} /></>}</button>
          <p className="setup-privacy"><LockKeyhole size={13} /> Your workspace is private to your account.</p>
        </form>
      </section>
    </div>
  </main>;
}
