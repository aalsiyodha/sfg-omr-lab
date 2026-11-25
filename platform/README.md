# OMR Lab Institute Platform — first draft

A separate Next.js application under `platform/`. **The production v2.7.1
scanner in the repository root is unchanged.**

## First-draft scope

- Responsive public landing page and interactive demo dashboard (no account needed)
- Supabase Google OAuth sign-up/sign-in and server-side sessions
- Create an institute; institute-scoped workspace and role-aware test creation
- 50-question test creation (matches current SFG scanner template)
- Manual answer key editor and strict CSV import/export
- Draft and published answer keys, immutable after publishing
- SQL schema for candidates, reviewed scan submissions, scores and leaderboard
- Row-level security / institute data isolation
- Dedicated real scoring RPC; do **not** trust browser-calculated totals

## Run

```bash
cd platform
npm install
npm run dev
```
Open http://localhost:3000/demo to try the dashboard without setting up auth.

## Enable real sign-in and database

1. Create a Supabase project.
2. In the Supabase SQL editor, run `supabase/schema.sql` then `supabase/results.sql`.
3. Enable **Google** under Authentication > Providers; configure a Google Cloud OAuth
   client and its Supabase callback.
4. Add `http://localhost:3000/auth/callback` to Supabase Auth redirect allowlist.
5. Copy `.env.example` to `.env.local` and fill in URL + publishable key.
   Never place a `service_role` / secret key in a `NEXT_PUBLIC_*` variable.
6. Deploy this **platform directory** as a separate Vercel project, adding its
   actual production URL to the OAuth redirect allowlist and environment variables.

## Privacy and release limitations

- No candidate images are automatically uploaded from the existing scanner.
  Integrating reviewed scans with the submission RPC is a separate step.
- Scanned results only qualify for storage after identity/timing verification
  and review. The database function computes marks against a published key.
- Example/demo student data is synthetic and saved only in the demo browser.
- Multiple answers incur the wrong-answer penalty in the current strict policy,
  and officially cancelled questions earn zero by default. Marking rules will
  need an explicit institute policy before wider rollout.
- The 50-question sheet is the only supported template in this draft.
- No subdomain routing, team invitations, billing, PDF upload, bulk scanning,
  student accounts, score editing or answer-key revision UI in this first draft.
- Production use requires a privacy policy, retention/deletion workflow,
  institute authorization review, and end-to-end OAuth / RLS tests.
- You can retain v2.7.1 at the original GitHub Pages URL.
