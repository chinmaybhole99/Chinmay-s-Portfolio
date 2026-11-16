"use client";

import { useState } from "react";
import Link from "next/link";
import { Activity, Bell, Bot, Building2, Check, ChevronDown, ChevronsUpDown, CircleCheck, Clock3, ExternalLink, GitBranch, GitPullRequest, LayoutDashboard, ListTodo, Menu, PanelLeftClose, PanelLeftOpen, Plus, Settings, Timer, UserRound, X } from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";
import { KanbanBoard } from "@/components/kanban-board";
import { AgentCenter } from "@/components/agent-center";
import type { Workspace } from "@/db/schema";

type View = "overview" | "board" | "ai-team" | "pull-requests" | "activity" | "profile" | "preferences" | "settings";
type UserInfo = { name: string; email: string; image: string | null };
const menuItems: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "board", label: "Board", icon: GitBranch },
  { id: "ai-team", label: "AI Team", icon: Bot },
  { id: "pull-requests", label: "Pull Requests", icon: GitPullRequest },
  { id: "activity", label: "Activity", icon: Activity },
];
const viewTitles: Record<View, string> = { overview: "Overview", board: "Board", "ai-team": "AI Team", "pull-requests": "Pull Requests", activity: "Activity", profile: "Profile", preferences: "Preferences", settings: "Settings" };
const overviewStats = [
  { label: "Open Tasks", value: "12", note: "Across your project", icon: ListTodo, tone: "sage" },
  { label: "In Progress", value: "04", note: "Being worked on now", icon: Timer, tone: "amber" },
  { label: "PR Ready", value: "02", note: "Ready for your review", icon: GitPullRequest, tone: "forest" },
];
const upcomingTasks = [
  { title: "Add workspace activity feed", repo: "devcrew / web-app", due: "Today", status: "In progress", tone: "progress" },
  { title: "Review authentication flow", repo: "devcrew / web-app", due: "Today", status: "Needs review", tone: "review" },
  { title: "Update project documentation", repo: "devcrew / web-app", due: "Tomorrow", status: "Upcoming", tone: "upcoming" },
];
const recentEvents = [
  { title: "Nova opened a pull request", detail: "#24 · Add workspace activity feed", time: "12 min ago", icon: GitPullRequest },
  { title: "You connected a repository", detail: "devcrew / web-app", time: "1 hour ago", icon: GitBranch },
  { title: "Atlas completed a task", detail: "Review authentication flow", time: "Yesterday", icon: CircleCheck },
];

function Avatar({ user, className = "" }: { user: UserInfo; className?: string }) {
  return <span className={`dashboard-avatar ${className}`}>{user.image ? <img src={user.image} alt="" /> : user.name.trim().charAt(0).toUpperCase()}</span>;
}

export function DashboardApp({ user, workspaces, activeWorkspace, activeView }: { user: UserInfo; workspaces: Workspace[]; activeWorkspace: Workspace; activeView: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const [workspaceMenu, setWorkspaceMenu] = useState(false);
  const [profileMenu, setProfileMenu] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const view = (Object.hasOwn(viewTitles, activeView) ? activeView : "overview") as View;

  function viewHref(nextView: string) { return `/dashboard?workspace=${encodeURIComponent(activeWorkspace.id)}&view=${encodeURIComponent(nextView)}`; }
  function workspaceHref(workspace: Workspace) { return `/dashboard?workspace=${encodeURIComponent(workspace.id)}&view=overview`; }

  return <main className={`dashboard-app ${collapsed ? "sidebar-collapsed" : ""}`}>
    {mobileOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`app-sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="sidebar-brand-row">
        <Link href="/dashboard" className="app-brand" aria-label="Devcrew home"><span className="brand-mark" aria-hidden="true"><span /></span><span className="brand-name">devcrew</span></Link>
        <button className="collapse-sidebar" type="button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
        <button className="mobile-close" type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={18} /></button>
      </div>

      <div className="workspace-switcher-wrap">
        <button className="workspace-switcher" type="button" onClick={() => setWorkspaceMenu(!workspaceMenu)} aria-expanded={workspaceMenu} title={activeWorkspace.name}>
          <span className="switcher-icon">{activeWorkspace.logo ? <img src={activeWorkspace.logo} alt="" /> : activeWorkspace.icon}</span>
          <span className="switcher-copy"><small>WORKSPACE</small><b>{activeWorkspace.name}</b></span><ChevronsUpDown size={15} className="switcher-chevron" />
        </button>
        {workspaceMenu && <div className="sidebar-popover workspace-popover">
          <span className="popover-caption">Your workspaces</span>
          {workspaces.map((workspace) => <Link key={workspace.id} className={`workspace-option ${workspace.id === activeWorkspace.id ? "current" : ""}`} href={workspaceHref(workspace)} onClick={() => setWorkspaceMenu(false)}><span className="option-mark">{workspace.logo ? <img src={workspace.logo} alt="" /> : workspace.icon}</span><span>{workspace.name}</span>{workspace.id === activeWorkspace.id && <Check size={15} />}</Link>)}
          <div className="popover-divider" /><Link href="/setup?new=1" className="workspace-create" onClick={() => setWorkspaceMenu(false)}><Plus size={16} /> Create a new workspace</Link>
        </div>}
      </div>

      <span className="sidebar-section-label">WORKSPACE</span>
      <nav className="sidebar-nav" aria-label="Main navigation">{menuItems.map(({ id, label, icon: Icon }) => <Link key={id} href={viewHref(id)} onClick={() => setMobileOpen(false)} title={collapsed ? label : undefined} aria-current={view === id ? "page" : undefined} className={`sidebar-nav-link ${view === id ? "active" : ""}`}><Icon size={18} strokeWidth={1.8} /><span>{label}</span></Link>)}</nav>

      <div className="sidebar-bottom">
        {profileMenu && <div className="sidebar-popover profile-popover"><div className="profile-popover-heading"><Avatar user={user} /><span><b>{user.name}</b><small>{user.email}</small></span></div><div className="popover-divider" />{(["profile", "preferences", "settings"] as View[]).map((item) => <Link key={item} href={viewHref(item)} onClick={() => setProfileMenu(false)} className="profile-option"><Settings size={15} />{viewTitles[item]}</Link>)}<div className="popover-divider" /><SignOutButton /></div>}
        <button type="button" className="sidebar-profile" onClick={() => setProfileMenu(!profileMenu)} aria-expanded={profileMenu} title={collapsed ? user.name : undefined}><Avatar user={user} /><span className="sidebar-user-copy"><b>{user.name}</b><small>Personal account</small></span><ChevronDown size={15} className="profile-chevron" /></button>
      </div>
    </aside>

    <section className="dashboard-main-column">
      <header className="dashboard-topbar"><div className="topbar-left"><button className="mobile-menu-button" type="button" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={19} /></button><div className="breadcrumbs"><span>{activeWorkspace.name}</span><span className="crumb-divider">/</span><b>{viewTitles[view]}</b></div></div>
        <div className="topbar-actions"><div className="notification-wrap"><button className={`topbar-icon-button ${notifications ? "selected" : ""}`} type="button" aria-label="Notifications" aria-expanded={notifications} onClick={() => setNotifications(!notifications)}><Bell size={18} /><i /></button>{notifications && <div className="sidebar-popover notification-popover"><b>Notifications</b><span className="notification-empty"><Check size={17} /> You’re all caught up.</span></div>}</div><Link href={viewHref("profile")} className="topbar-profile-button" aria-label={`Profile for ${user.name}`}><Avatar user={user} /></Link></div>
      </header>

      <div className="dashboard-page-content">
        {view === "overview" ? <>
          <div className="dashboard-page-heading overview-heading"><div><span className="setup-step">YOUR WORKSPACE</span><h1>Welcome, {user.name.split(" ")[0]}.</h1><p>Here’s the home for your team’s work.</p></div><a className="overview-project-link" href={activeWorkspace.repositoryUrl} target="_blank" rel="noreferrer"><GitBranch size={15} /><span>{activeWorkspace.repository}</span><ExternalLink size={13} /></a></div>
          <section className="overview-stats" aria-label="Project summary">{overviewStats.map(({ label, value, note, icon: Icon, tone }) => <article className="overview-stat-card" key={label}><span className={`stat-icon ${tone}`}><Icon size={18} strokeWidth={1.8} /></span><span className="stat-note">{note}</span><strong>{value}</strong><h2>{label}</h2></article>)}</section>
          <section className="overview-main-grid">
            <article className="overview-panel tasks-panel"><header className="overview-panel-header"><div><span className="summary-label">ON THE HORIZON</span><h2>Upcoming Tasks</h2></div><Link href={viewHref("board")} className="panel-action">View board <ExternalLink size={13} /></Link></header><div className="task-list">{upcomingTasks.map((task, index) => <div className="upcoming-task" key={task.title}><span className="task-check" aria-hidden="true">{index === 1 ? <CircleCheck size={17} /> : <span />}</span><div className="task-copy"><b>{task.title}</b><small>{task.repo}</small></div><div className="task-meta"><span className={`task-status ${task.tone}`}>{task.status}</span><small><Clock3 size={12} />{task.due}</small></div></div>)}</div><Link href={viewHref("board")} className="all-tasks-link">See all tasks <span>→</span></Link></article>
            <article className="overview-panel office-panel"><header className="overview-panel-header"><div><span className="summary-label">YOUR AI TEAM</span><h2>Agent Office</h2></div><span className="office-live"><i /> Live</span></header><div className="office-placeholder"><div className="office-grid" /><div className="office-orbit orbit-one" /><div className="office-orbit orbit-two" /><span className="office-building"><Building2 size={31} strokeWidth={1.4} /></span><span className="office-caption">AI AGENT OFFICE SPACE</span></div><p className="office-footnote">A shared space for your agents to work together.</p></article>
          </section>
          <section className="overview-panel recent-panel"><header className="overview-panel-header"><div><span className="summary-label">THE LATEST</span><h2>Recent Activity</h2></div><Link href={viewHref("activity")} className="panel-action">View activity <ExternalLink size={13} /></Link></header><div className="activity-list">{recentEvents.map(({ title, detail, time, icon: Icon }) => <div className="activity-row" key={title}><span className="activity-icon"><Icon size={15} /></span><div className="activity-copy"><b>{title}</b><small>{detail}</small></div><time>{time}</time></div>)}</div></section>
        </> : view === "board" ? <KanbanBoard repository={activeWorkspace.repository} userName={user.name} workspaceId={activeWorkspace.id} /> : view === "ai-team" ? <AgentCenter workspaceId={activeWorkspace.id} repository={activeWorkspace.repository} /> : <section className="section-placeholder"><span className="placeholder-icon">{view === "pull-requests" ? <GitPullRequest /> : view === "activity" ? <Activity /> : <UserRound />}</span><span className="setup-step">{viewTitles[view].toUpperCase()}</span><h1>{viewTitles[view]}</h1><p>{view === "settings" || view === "preferences" || view === "profile" ? "Manage your account and workspace preferences." : `Your ${viewTitles[view].toLowerCase()} for ${activeWorkspace.name} will appear here.`}</p>{view === "settings" && <div className="settings-summary"><span><b>Workspace</b><small>{activeWorkspace.name}</small></span><span><b>Repository</b><small>{activeWorkspace.repository}</small></span><span><b>Account</b><small>{user.email}</small></span></div>}</section>}
        <footer className="dashboard-footer">A focused space for work that matters.<span>Devcrew · Workspace</span></footer>
      </div>
    </section>
  </main>;
}
