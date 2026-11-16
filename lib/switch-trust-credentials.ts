import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";

function encryptionKey() {
  const secret = process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET_KEY;
  if (!secret) throw new Error("Configure BETTER_AUTH_SECRET before saving Switch Trust credentials.");
  return createHash("sha256").update(secret).digest();
}

export function encryptSwitchTrustApiKey(apiKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptSwitchTrustApiKey(payload: string) {
  const [ivPart, tagPart, encryptedPart] = payload.split(".");
  if (!ivPart || !tagPart || !encryptedPart) throw new Error("Stored Switch Trust credentials are invalid.");
  const decipher = createDecipheriv(algorithm, encryptionKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedPart, "base64url")), decipher.final()]).toString("utf8");
}

export function normalizeSwitchTrustInstance(value: unknown) {
  const raw = typeof value === "string" && value.trim() ? value.trim() : "https://app.switchagents.ai";
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Enter a valid Switch Trust instance URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Use an HTTPS Switch Trust instance origin, such as https://app.switchagents.ai.");
  }
  const hostname = url.hostname.toLowerCase();
  const isSwitchHost = hostname === "switchagents.ai" || hostname.endsWith(".switchagents.ai") || hostname === "flintai.dev" || hostname.endsWith(".flintai.dev");
  if (!isSwitchHost) throw new Error("Use a Switch Trust hosted instance URL.");
  return url.origin;
}
