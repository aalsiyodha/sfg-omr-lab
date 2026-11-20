# OMR Labs — Next.js Migration Shell

This is an **isolated Next.js 16 prototype** on `experiment/nextjs-multitenant-migration`. It does not replace the Vite scanner.

## Run locally

Requires Node.js >=20.9 and npm.

```powershell
cd apps/web
npm install
npm run dev
```

Open `http://localhost:3001/`, `http://localhost:3001/dashboard`, `http://localhost:3001/s/sfg`, and `http://localhost:3001/s/sfg/scan`.

Optional tenant-subdomain preview: `http://sfg.localhost:3001/` if supported by your browser/OS. Use /s/sfg without DNS configuration.

**Do not point Vercel or GitHub Pages to this directory yet.** It is only a Next.js shell with demo data. Existing production scanner v2.3 stays on `main`.

## Current implementation

- Next.js 16 App Router and responsive public landing page
- demo-only institute dashboard and SFG/ABC tenant workspaces
- basic host-to-tenant rewrite in `proxy.ts`
- first scanner interface contract at `../../packages/scanner-core/src/contracts.ts`
- link to validated v2.3 scanner while porting engine
- no user signup, no database, no upload/evaluation in this Next.js shell

## Architecture rule

The original Vite source remains unmodified; first migrate the old 50-question engine with golden fixtures and byte-for-byte decision comparison before modifying geometry or adding 100/150 templates.
