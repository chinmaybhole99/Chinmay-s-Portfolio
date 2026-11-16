import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { eq } from "drizzle-orm";

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.userId, session.user.id)).limit(1);
  redirect(workspace ? "/dashboard" : "/setup");
}
