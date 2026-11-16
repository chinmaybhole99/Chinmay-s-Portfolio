import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { eq } from "drizzle-orm";
import { DashboardApp } from "@/components/dashboard-app";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ workspace?: string; view?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const params = await searchParams;
  const ownedWorkspaces = await db.select().from(workspaces).where(eq(workspaces.userId, session.user.id)).orderBy(workspaces.createdAt);
  if (!ownedWorkspaces.length) redirect("/setup");
  const activeWorkspace = ownedWorkspaces.find((workspace) => workspace.id === params.workspace) ?? ownedWorkspaces[0];
  return <DashboardApp
    user={{ name: session.user.name, email: session.user.email, image: session.user.image ?? null }}
    workspaces={ownedWorkspaces}
    activeWorkspace={activeWorkspace}
    activeView={params.view ?? "overview"}
  />;
}
