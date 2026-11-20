# Next.js multi-tenant OMR migration — experiment

Status: architecture proposal, not an implemented Next.js migration.
Branch: `experiment/nextjs-multitenant-migration`
Baseline: SFG OMR Lab v2.3 from `main`.
Production safety: keep `main` and existing GitHub Pages deployment unchanged. Do not merge migration work before scanner equivalence testing.

## Vision

One platform, many institute tenants:

- `omrlabs.com` — platform landing site / operator console.
- `sfg.omrlabs.com` — SFG-branded workspace.
- `abc.omrlabs.com` — another institute workspace.
- Common scanning engine and separately configurable institute/test policies.
- Initial sheet formats: 50, 100, and 150 questions.
- Future scope, explicitly deferred: tenant-specific Test ID rules, institutional logos on generated OMR PDFs, full custom OMR template generation, advanced SaaS administration/billing.

Domain names are examples only; no domain purchase or DNS configuration is implied.

## Non-negotiable design choices

1. **Preserve the proven scanner.** Extract it from UI routing before making algorithm changes. No concurrent scanner rewrite.
2. **Keep scanning in the browser at first.** OpenCV.js currently depends on browser canvas and image APIs. Next.js server components must not import or execute this code; use client boundaries or dynamic imports as needed.
3. **Make sheet geometry a typed configuration, not scattered constants.** One `SheetDefinition` for each format. Multiple formats should be validated using generated fixtures and real scans, not assumed to work from a changed question count.
4. **Separate tenant, template, scan, and scoring policies.** Tenant decides branding and permitted templates; sheet definition controls bubble geometry; scoring policy handles marks and Test ID rules.
5. **Fail closed.** QR, registration, timing marks, orientation, validation and review rules must continue protecting questionable scans.
6. **Tenant identity is server-validated.** Do not trust client-provided tenant IDs or a subdomain alone for authorization; enforce tenant isolation in server data access.
7. **No production-host migration until parity.** Public v2.3 stays available independently.

## Proposed workspace organization (target, not yet implemented)

```text
apps/
  web/                   # Next.js App Router: landing + tenant-facing app
packages/
  scanner-core/          # geometry registration, OCR/QR, bubble detection, calibration
  sheet-definitions/     # typed geometry + 50/100/150 sheet variants
  scoring/               # scoring and answer validation
  shared-types/          # ScanResult, SheetDefinition, TenantConfig, etc.
docs/
  NEXTJS_MIGRATION_PLAN.md
```

For the first migration milestone it may be simpler to retain the existing Vite project at repository root and add `apps/web` + packages incrementally. Only move or remove old source after a verified replacement works.

## Processing boundaries

- `scanner-core`: `scan(image, sheetDefinition, scanOptions) => ScanResult`. Browser-canvas adapters can remain separate from pure geometry/classification code.
- `sheet-definitions`: immutable, versioned geometry with per-row positions, timing marks, registration fiducials, QR zone, calibration strip and identity zones. Define 50/100/150 as separate template versions.
- `tenant-config`: tenant slug, institution name, branding, permitted sheet definitions, default scoring policy. Do not hardcode SFG into scanner algorithms.
- `apps/web`: Next.js App Router, scan UI, settings, results, tenant context. Start with one local tenant configuration before introducing database/auth.
- Future persistence: server-side tenant scoping, auth/roles, rate limits, auditability, storage consent and deletion.

## Deployment and routing

- Next.js 16 uses `proxy.ts` for request-level domain/subdomain routing. Enforce safe hostname parsing; map supported hostnames to known tenant slugs.
- Local development can use explicit test-host mappings; never depend on public DNS for local tests.
- Next.js dynamic server features cannot be deployed as a conventional static GitHub Pages website. Keep the existing Vite Pages build separate; use a Next.js-capable host for previews and eventual SaaS.
- Choose a host/domain only after the migration prototype works. Tenant routing does not require separate deployments per tenant.

## Migration milestones

- [ ] 0. Capture stable v2.3 scanner fixtures and result baselines (50 questions, difficult photos, invalid marks, upside-down images).
- [ ] 1. Create Next.js shell on this branch with shared layout and an initial SFG tenant.
- [ ] 2. Extract scanner processing into a browser-safe workspace package with existing tests unchanged.
- [ ] 3. Rebuild scan/review/results UI and verify identical 50-question output against Vite.
- [ ] 4. Introduce versioned `SheetDefinition`, first matching the current 50-question geometry.
- [ ] 5. Design and validate independent 100-question sheet + scanner fixture set.
- [ ] 6. Design and validate independent 150-question sheet + scanner fixture set.
- [ ] 7. Add tenant routing and scoped configuration for `sfg` and `abc`, initially without billing.
- [ ] 8. Add production auth/data isolation and hosted deployment testing before any external multi-tenant use.

## Acceptance for each scanner milestone

- npm test and production Next.js build pass.
- Previously valid marks remain valid and invalid partial/tick/hatch marks are not promoted.
- QR, printed timing bands, calibration, Test ID extraction, rotation/perspective validation remain verified.
- All 50 baseline answers, diagnostics and confidence/reject evidence match the reference before refactoring classification.
- 100/150 templates require separate position/geometry, identity, generation, and photographed-sheet validation.
- Browser camera/file upload and accessible review flow work on desktop and mobile.

## First practical next step

Build an isolated Next.js shell inside `apps/web` on this experimental branch, leaving the Vite app at root intact. Move scanner code only after repeatable test fixtures are available. No merge to `main` until equivalent behavior is demonstrated.
