import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { eq } from "drizzle-orm";
import { WorkspaceSetup } from "@/components/workspace-setup";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const { new: createNew } = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.userId, session.user.id)).limit(1);
  if (workspace && createNew !== "1") redirect("/dashboard");
  return <WorkspaceSetup userName={session.user.name} githubConfigured={Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)} />;
}
