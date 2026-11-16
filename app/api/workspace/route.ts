import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { accounts, workspaces } from "@/db/schema";

const icons = ["✳", "◈", "⬡", "✦", "◉", "⌘"];

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "";
  const repository = typeof body?.repository === "string" ? body.repository : "";
  const repositoryUrl = typeof body?.repositoryUrl === "string" ? body.repositoryUrl : "";
  const icon = typeof body?.icon === "string" && icons.includes(body.icon) ? body.icon : icons[0];
  const logo = typeof body?.logo === "string" && body.logo.startsWith("data:image/") && body.logo.length < 1_500_000 ? body.logo : null;
  if (!name || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !repositoryUrl.startsWith("https://github.com/")) {
    return NextResponse.json({ error: "Enter a workspace name and choose a GitHub repository." }, { status: 400 });
  }
  const [account] = await db.select({ accessToken: accounts.accessToken }).from(accounts)
    .where(and(eq(accounts.userId, session.user.id), eq(accounts.providerId, "github"))).limit(1);
  if (!account?.accessToken) return NextResponse.json({ error: "Connect GitHub before saving your workspace." }, { status: 400 });
  const githubResponse = await fetch(`https://api.github.com/repos/${repository}`, {
    headers: { Authorization: `Bearer ${account.accessToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    cache: "no-store",
  });
  if (!githubResponse.ok) return NextResponse.json({ error: "Choose a repository that is accessible from your connected GitHub account." }, { status: 400 });
  const githubRepo = await githubResponse.json();
  if (githubRepo.full_name?.toLowerCase() !== repository.toLowerCase() || githubRepo.html_url !== repositoryUrl) {
    return NextResponse.json({ error: "The selected repository does not match your GitHub account." }, { status: 400 });
  }
  const [workspace] = await db.insert(workspaces).values({ id: crypto.randomUUID(), userId: session.user.id, name, icon, logo, repository, repositoryUrl }).returning({ id: workspaces.id });
  return NextResponse.json({ ok: true, id: workspace.id });
}
