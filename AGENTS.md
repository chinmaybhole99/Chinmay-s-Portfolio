# Devcrew project conventions

## Design and typography
- Follow the attached Devcrew Design and Typography Palette: calm editorial styling, warm ivory surfaces, deep forest green, muted sage, and restrained amber accents.
- Use the shared CSS custom properties in `app/globals.css` for all application colors. Add or update tokens there rather than hardcoding a new palette in components.
- Use the existing sans-serif UI stack for controls and body text; use Georgia/serif for large editorial headings. Keep labels compact, readable, and consistently spaced.
- Prefer quiet borders, generous whitespace, clear focus states, and subtle motion. Respect `prefers-reduced-motion`.

## Code conventions
- Keep route-specific UI in App Router route files and reusable/client-interactive UI in `components/`.
- Authenticate server routes with Better Auth using `auth.api.getSession({ headers: await headers() })`; scope every user-owned database query by the authenticated user ID.
- Use Drizzle schema definitions from `db/schema.ts` and database access through `db/index.ts`.
- Use TypeScript, descriptive names, accessible labels, semantic HTML, and clear loading/error feedback for interactive forms.
- Keep credentials in environment variables. Never expose OAuth access tokens in browser responses.

## Project structure
- `app/`: Next.js App Router pages and API routes.
- `components/`: shared and interactive React components.
- `db/`: Drizzle schema and database client.
- `lib/`: authentication and shared application helpers.
