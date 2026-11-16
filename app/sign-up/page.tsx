import { AuthForm } from "@/components/auth-form";

export default function SignUpPage() {
  return (
    <AuthForm
      mode="sign-up"
      providers={{
        google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
      }}
    />
  );
}
