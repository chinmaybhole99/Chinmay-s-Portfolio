import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { accounts, workspaces } from "@/db/schema";

const githubHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

async function getGitHubContext(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { response: NextResponse.json({ error: "Sign in to continue." }, { status: 401 }) };
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") || (await request.json().catch(() => null))?.workspaceId;
  if (typeof workspaceId !== "string" || !workspaceId) return { response: NextResponse.json({ error: "Choose a workspace first." }, { status: 400 }) };
  const [workspace] = await db.select().from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, session.user.id))).limit(1);
  if (!workspace) return { response: NextResponse.json({ error: "Workspace not found." }, { status: 404 }) };
  const [account] = await db.select({ accessToken: accounts.accessToken }).from(accounts)
    .where(and(eq(accounts.userId, session.user.id), eq(accounts.providerId, "github"))).limit(1);
  if (!account?.accessToken) return { response: NextResponse.json({ error: "Connect GitHub to access repository issues." }, { status: 400 }) };
  return { token: account.accessToken, repository: workspace.repository };
}

function normalizeIssue(issue: any) {
  const labels = (issue.labels ?? []).map((label: any) => typeof label === "string" ? label : label.name).filter(Boolean) as string[];
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  const type = normalizedLabels.some((label) => label.includes("bug"))
    ? "Bug"
    : normalizedLabels.some((label) => label.includes("feature") || label.includes("enhancement")) ? "Feature" : "Issue";
  const priority = normalizedLabels.some((label) => /(^|\b)(p0|p1|urgent|critical|high)(\b|$)/.test(label))
    ? "High"
    : normalizedLabels.some((label) => /(^|\b)(p3|low)(\b|$)/.test(label)) ? "Low" : "Medium";
  const labelStage = normalizedLabels.find((label) => label.startsWith("status:") || label.startsWith("status/")) ?? "";
  const stageText = labelStage.replace(/^status[:/ ]*/, "").replace(/-/g, " ").trim();
  const stage = stageText.includes("develop") || stageText.includes("progress") ? "In Development"
    : stageText.includes("review") ? "In Review"
    : stageText.includes("test") ? "Testing"
    : stageText.includes("done") || stageText.includes("ready") ? "Done/PR Ready" : "Todo";
  return {
    id: String(issue.number),
    title: issue.title,
    description: issue.body ?? "",
    type,
    priority,
    stage,
    assignee: issue.assignees?.[0]?.login ?? "Unassigned",
    due: issue.milestone?.due_on ? new Date(issue.milestone.due_on).toLocaleDateString("en", { month: "short", day: "numeric" }) : "No due date",
    url: issue.html_url,
  };
}

export async function GET(request: Request) {
  const context = await getGitHubContext(request);
  if ("response" in context) return context.response;
  const response = await fetch(`https://api.github.com/repos/${context.repository}/issues?state=open&per_page=100&sort=updated&direction=desc`, {
    headers: githubHeaders(context.token), cache: "no-store",
  });
  if (!response.ok) return NextResponse.json({ error: "GitHub could not load issues for this repository." }, { status: response.status });
  const issues = await response.json();
  return NextResponse.json(issues.filter((issue: any) => !issue.pull_request).map(normalizeIssue));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const context = await getGitHubContext(new Request(`${new URL(request.url).origin}/api/github/issues?workspaceId=${encodeURIComponent(workspaceId)}`));
  if ("response" in context) return context.response;
  const action = typeof body?.action === "string" ? body.action : "create";
  const issueNumber = Number(body?.issueNumber);

  if (action === "run" || action === "close" || action === "update") {
    if (!Number.isInteger(issueNumber) || issueNumber < 1) return NextResponse.json({ error: "A valid GitHub issue number is required." }, { status: 400 });
    const issueUrl = `https://api.github.com/repos/${context.repository}/issues/${issueNumber}`;
    let update: Record<string, unknown>;
    if (action === "run") {
      const userResponse = await fetch("https://api.github.com/user", { headers: githubHeaders(context.token), cache: "no-store" });
      if (!userResponse.ok) return NextResponse.json({ error: "GitHub could not identify your account." }, { status: userResponse.status });
      const githubUser = await userResponse.json();
      update = { assignees: [githubUser.login] };
    } else if (action === "close") {
      update = { state: "closed" };
    } else {
      update = {
        title: typeof body?.title === "string" ? body.title.trim().slice(0, 200) : undefined,
        body: typeof body?.description === "string" ? body.description.slice(0, 60_000) : undefined,
      };
      if (!update.title) return NextResponse.json({ error: "Issue title is required." }, { status: 400 });
    }
    const response = await fetch(issueUrl, { method: "PATCH", headers: { ...githubHeaders(context.token), "Content-Type": "application/json" }, body: JSON.stringify(update), cache: "no-store" });
    if (!response.ok) return NextResponse.json({ error: action === "close" ? "GitHub could not close this issue." : "GitHub could not update this issue." }, { status: response.status });
    const issue = await response.json();
    return NextResponse.json({ ...normalizeIssue(issue), assignee: action === "run" ? issue.assignees?.[0]?.login ?? "Unassigned" : normalizeIssue(issue).assignee });
  }

  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 200) : "";
  const description = typeof body?.description === "string" ? body.description.slice(0, 60_000) : "";
  if (!title) return NextResponse.json({ error: "Issue title is required." }, { status: 400 });
  const response = await fetch(`https://api.github.com/repos/${context.repository}/issues`, {
    method: "POST",
    headers: { ...githubHeaders(context.token), "Content-Type": "application/json" },
    body: JSON.stringify({ title, body: description || undefined }),
    cache: "no-store",
  });
  if (!response.ok) return NextResponse.json({ error: "GitHub could not create this issue." }, { status: response.status });
  return NextResponse.json(normalizeIssue(await response.json()), { status: 201 });
}
