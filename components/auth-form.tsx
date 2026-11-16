"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Github, LoaderCircle, LockKeyhole, Mail, UserRound } from "lucide-react";
import { authClient } from "@/lib/auth-client";

type AuthFormProps = {
  mode: "sign-in" | "sign-up";
  providers: { google: boolean; github: boolean };
};

export function AuthForm({ mode, providers }: AuthFormProps) {
  const router = useRouter();
  const isSignUp = mode === "sign-up";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    try {
      const result = isSignUp
        ? await authClient.signUp.email({ name, email, password, callbackURL: "/" })
        : await authClient.signIn.email({ email, password, callbackURL: "/" });

      if (result.error) {
        setError(result.error.message || "We couldn't authenticate you. Please try again.");
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again in a moment.");
    } finally {
      setPending(false);
    }
  }

  async function signInWith(provider: "google" | "github") {
    setPending(true);
    setError("");

    try {
      const result = await authClient.signIn.social({ provider, callbackURL: "/" });
      if (result.error) {
        setError(result.error.message || `Unable to continue with ${provider === "google" ? "Google" : "GitHub"}.`);
        setPending(false);
      }
    } catch (cause) {
      console.error("Social sign-in request failed", cause);
      setError(cause instanceof Error && cause.message
        ? `Could not reach the sign-in service (${cause.message}). Check the app URL and try again.`
        : "Could not reach the sign-in service. Check the app URL and try again.");
      setPending(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-aside" aria-label="Devcrew workspace">
        <Link className="auth-brand" href="/">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>devcrew</span>
        </Link>
        <div className="aside-copy">
          <span className="eyebrow"><span className="eyebrow-dot" /> YOUR WORK, IN GOOD COMPANY</span>
          <h1>Make room<br />for <em>great work.</em></h1>
          <p>Bring your ideas and your team into one focused space. The next good thing starts here.</p>
        </div>
        <div className="aside-note">
          <div className="avatar-stack" aria-hidden="true"><span>J</span><span>M</span><span>A</span><span>+</span></div>
          <span>Built for teams that build things.</span>
        </div>
        <div className="aside-grid" aria-hidden="true" />
        <div className="aside-orbit aside-orbit-one" aria-hidden="true" />
        <div className="aside-orbit aside-orbit-two" aria-hidden="true" />
      </section>

      <section className="auth-main">
        <div className="auth-mobile-brand"><span className="brand-mark" aria-hidden="true"><span /></span><span>devcrew</span></div>
        <div className="auth-content">
          <div className="auth-heading">
            <span className="auth-kicker">{isSignUp ? "START SOMETHING GOOD" : "WELCOME BACK"}</span>
            <h2>{isSignUp ? "Create your account" : "Sign in to Devcrew"}</h2>
            <p>{isSignUp ? "A clearer space for your best work." : "Pick up right where your team left off."}</p>
          </div>

          {(providers.google || providers.github) && (
            <div className="social-buttons">
              {providers.google && (
                <button className="social-button" type="button" onClick={() => signInWith("google")} disabled={pending}>
                  <span className="google-mark" aria-hidden="true">G</span><span>Continue with Google</span>
                </button>
              )}
              {providers.github && (
                <button className="social-button" type="button" onClick={() => signInWith("github")} disabled={pending}>
                  <Github size={18} strokeWidth={2} aria-hidden="true" /><span>Continue with GitHub</span>
                </button>
              )}
            </div>
          )}

          {(providers.google || providers.github) && (
            <div className="auth-divider"><span>or continue with email</span></div>
          )}

          <form className="auth-form" onSubmit={submit}>
            {isSignUp && (
              <label className="auth-field">
                <span>Your name</span>
                <span className="field-wrap"><UserRound size={17} aria-hidden="true" /><input autoComplete="name" name="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Alex Morgan" required /></span>
              </label>
            )}
            <label className="auth-field">
              <span>Email address</span>
              <span className="field-wrap"><Mail size={17} aria-hidden="true" /><input autoComplete="email" name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" required /></span>
            </label>
            <label className="auth-field">
              <span className="field-label-row"><span>Password</span>{!isSignUp && <span className="password-hint">Secure sign-in</span>}</span>
              <span className="field-wrap"><LockKeyhole size={17} aria-hidden="true" /><input autoComplete={isSignUp ? "new-password" : "current-password"} name="password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" minLength={8} required /><button className="password-toggle" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>
            </label>

            {error && <p className="auth-error" role="alert">{error}</p>}

            <button className="auth-submit" type="submit" disabled={pending}>
              {pending ? <LoaderCircle className="loading-icon" size={18} aria-hidden="true" /> : <>{isSignUp ? "Create account" : "Sign in"}<ArrowRight size={17} aria-hidden="true" /></>}
            </button>
          </form>

          <p className="auth-switch">
            {isSignUp ? "Already have an account?" : "New to Devcrew?"}{" "}
            <Link href={isSignUp ? "/sign-in" : "/sign-up"}>{isSignUp ? "Sign in" : "Create an account"}</Link>
          </p>
        </div>
        <footer className="auth-footer"><span>© {new Date().getFullYear()} Devcrew</span><span className="footer-status"><span /> All systems operational</span></footer>
      </section>
    </main>
  );
}
