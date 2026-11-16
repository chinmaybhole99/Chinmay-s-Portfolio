"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <button className="sign-out-button" type="button" onClick={signOut} disabled={pending}>
      {pending ? <LoaderCircle className="loading-icon" size={16} /> : <LogOut size={16} />}
      Sign out
    </button>
  );
}
