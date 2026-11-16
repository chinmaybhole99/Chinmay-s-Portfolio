import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { accounts, sessions, users, verifications } from "@/db/schema";
import { db } from "@/db";

const socialProviders = {
  ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        },
      }
    : {}),
  ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
    ? {
        github: {
          clientId: process.env.GITHUB_CLIENT_ID,
          clientSecret: process.env.GITHUB_CLIENT_SECRET,
        },
      }
    : {}),
};

// Keep local OAuth callbacks on localhost, while allowing AUTH_URL to define
// the public callback origin in production when both aliases are present.
const baseURL = process.env.NODE_ENV === "production"
  ? process.env.AUTH_URL ?? process.env.BETTER_AUTH_URL
  : process.env.BETTER_AUTH_URL ?? process.env.AUTH_URL;

function getOrigin(value: string | undefined) {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function isLocalOrigin(origin: string) {
  const hostname = new URL(origin).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

const configuredOrigins = [
  baseURL,
  process.env.AUTH_URL,
  process.env.BETTER_AUTH_URL,
  process.env.NEXT_PUBLIC_APP_URL,
].map(getOrigin);

const trustedOrigins = Array.from(new Set([
  ...configuredOrigins.filter((origin): origin is string =>
    Boolean(origin) && (process.env.NODE_ENV !== "production" || !isLocalOrigin(origin)),
  ),
  ...(process.env.NODE_ENV === "production" ? [] : ["http://localhost:3000", "http://127.0.0.1:3000"]),
]));

export const auth = betterAuth({
  baseURL,
  trustedOrigins,
  secret: process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET_KEY,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: users, session: sessions, account: accounts, verification: verifications },
  }),
  socialProviders,
  emailAndPassword: {
    enabled: true,
  },
});
