import { AuthForm } from "@/components/auth-form";

export default function SignInPage() {
  return (
    <AuthForm
      mode="sign-in"
      providers={{
        google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
      }}
    />
  );
}
