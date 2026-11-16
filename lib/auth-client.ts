import { createAuthClient } from "better-auth/react";

// Let Better Auth use the browser's current origin. A build-time localhost URL
// otherwise sends production sign-in requests back to each visitor's machine.
export const authClient = createAuthClient();
