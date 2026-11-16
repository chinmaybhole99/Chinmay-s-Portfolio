import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { accounts } from "@/db/schema";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const [account] = await db.select({ accessToken: accounts.accessToken }).from(accounts)
    .where(and(eq(accounts.userId, session.user.id), eq(accounts.providerId, "github"))).limit(1);
  if (!account?.accessToken) return NextResponse.json({ error: "Connect GitHub to load your repositories." }, { status: 400 });
  const response = await fetch("https://api.github.com/user/repos?sort=updated&per_page=100&visibility=all", {
    headers: { Authorization: `Bearer ${account.accessToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    cache: "no-store",
  });
  if (!response.ok) return NextResponse.json({ error: "GitHub could not return your repositories. Reconnect your account and try again." }, { status: response.status });
  const repos = await response.json();
  return NextResponse.json(repos.map((repo: { full_name: string; html_url: string; private: boolean; description: string | null }) => ({ name: repo.full_name, url: repo.html_url, isPrivate: repo.private, description: repo.description })));
}
