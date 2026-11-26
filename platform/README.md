# OMRLabs — Neon Development Integration

The Next.js application lives in `platform/` of the existing GitHub repository.
The production scanner and the original working institute demo are unchanged.

**Neon project:** `long-forest-88912260` in org `omrlabs`.
**Development database branch:** `omrlabs-dev`.
**Git branch:** `feature/neon-institute-platform`.

## Runtime
- Next.js + React + TypeScript
- Neon PostgreSQL: `@neondatabase/serverless` parameterized SQL from server components/actions
- Managed Neon Auth (Google OAuth and email/password), via `@neondatabase/auth/next`
- Scanner: snapshot of v2.7.1 OpenCV.js, run locally in browser
- Redis: not required

## Environment (server-side only)
```
DATABASE_URL=<pooled Neon development Postgres connection>
NEON_AUTH_BASE_URL=<Neon Auth URL for omrlabs-dev>
NEON_AUTH_COOKIE_SECRET=<cryptographically random >=32-character secret>
```

Variables must be set in Vercel's **preview** environment or a local ignored
`.env.local`. NEVER commit connection strings, auth cookies, secrets or
candidate records. Do not use `NEXT_PUBLIC_` for passwords or database credentials.

## Flow
1. Open /login and sign in with Google using Neon Auth.
2. Create an institute; server creates owner membership.
3. Create a 50-question test, import key CSV, save and publish.
4. Upload OMR photograph and verify QR, correct printed test ID and 50/50 timing.
5. Review every flagged response and calculate local score.
6. The signed-in reviewer approves the scan and saves it to Neon.
7. The server independently recalculates marks from the *published database key*,
   then saves candidate, reviewed responses, score, and reviewer ID.
8. Leaderboard and question analytics query reviewed scans with institute membership checks.

## Security and limitations
All SQL is parameterized and each server-side data query is scoped to the
authenticated user's institute membership. Only owner/admin may create or publish
keys. The published key cannot be edited after publication (database trigger).

**Important:** v0.3 is an institute-operated pilot. The photographed OMR is
processed in the browser; server receipt of QR/timing validation is based on the
reviewer's signed-off submission, not independent server-side image reprocessing.
Do not expose reviewer approval to public student accounts. Add signed scanner
proof or server-side verification before enabling untrusted student submissions.

No images are automatically retained in Neon. Demo changes stay in localStorage.
Auth sign-in and submitted real rows must be manually verified in a browser.

## Build and test
```bash
cd platform
npm install
npm run typecheck
npm run build
npm run dev
```
Open /demo for the no-login demo or /login for Neon-backed testing.
