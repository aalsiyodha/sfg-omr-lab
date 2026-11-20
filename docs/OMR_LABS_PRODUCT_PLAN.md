# OMR Labs — SaaS product, website and Next.js migration plan

Status: **proposal and migration roadmap**. This document combines decisions from the product discussion with implementation milestones. It does **not** imply these features are built.

## Product thesis
OMR Labs is a B2B examination operations SaaS. **Institutes pay** for scanning, test creation, scoring, rankings, and institutional analytics. Students are primarily participants/result viewers; a separate direct-to-student product is optional later.

The first deliverable is a **Next.js website shell and a scanner migration without regression**, not a redesign of scanner algorithms.

## Audience and sites

| URL (illustrative) | Primary audience | Purpose |
|---|---|---|
| omrlabs.com | institute decision-makers | marketing, capabilities, pricing/contact, lead acquisition |
| dashboard.omrlabs.com | institute owners, staff and examiners | institute operations, users, billing, tests, keys, submissions, rankings |
| sfg.omrlabs.com | SFG students and optionally staff | branded exam portal, authorized submissions, results |
| abc.omrlabs.com | ABC students | isolated branded portal |
| admin.omrlabs.com | OMR Labs internal team | institute onboarding, support, billing, audits |
| app.omrlabs.com | individual students (future) | direct student self-service |

Domains have not been bought or configured. Use path-based routes during development; add subdomain routing after identity boundaries are tested.

## Public marketing website (first visual work)

Visual direction: clean, restrained, premium B2B SaaS; off-white backgrounds, deep navy typography, indigo accent, subtle borders, abundant whitespace, polished empty states. Avoid an internal debugging-tool aesthetic.

Pages:
- Home: headline, institute outcomes, clear product demo link, testimonials only when real, contact CTA.
- Platform: scanning -> review -> scores -> rankings; explain human-in-loop validation.
- Solutions: coaching institutes, schools, test-prep providers, exam administrators.
- Pricing: initially contact sales / transparent tiers once unit costs and economics known; avoid inventing prices.
- Security & privacy: explain data partitioning, upload/storage policy and processing boundaries; no unsupported compliance claims.
- Contact / request a demo; documentation/help.

## Institute dashboard (B2B product)

Navigation: Overview, Tests, OMR Scans, Review Queue, Answer Keys, Results, Rankings, Students / Batches, Reports, Institute Settings, Team & Permissions, Billing, Support.

Principal workflows:
1. Institute is onboarded and assigned unique immutable internal tenant ID.
2. Institute owner invites examiners/staff using tenant-scoped roles.
3. Examiner creates an examination with sheet definition (50, 100, 150), subject/category, schedule and scoring policy.
4. Examiner uploads CSV/XLSX answer key or fills a grid, sees validation and preview; supports key version/approval.
5. Sheets arrive via manual uploads or future batch scanning; scanner reads answers and records source/evidence.
6. Uncertain/invalid sheets go to a human-review queue and cannot silently score as fully valid.
7. Results are calculated using *specific* answer-key, sheet and scoring-policy versions.
8. Institute approves and publishes results.
9. Ranks, batch comparisons, score distributions and progress charts derive only from eligible published/finalized results.
10. Students can see only authorized results under their institute's rules.

Ranking decisions to specify: ties (competition/dense/unique), absent/disqualified students, multiple attempts, corrections, rank cohorts and publication timing. Version corrected answer keys and recalculate/reapprove explicitly.

## Core scanner and sheet definitions

- Keep the proven v2.3 50-question engine unchanged until test parity is established.
- Extract browser-facing canvas/OpenCV integration from pure geometry, measurement, scoring, validation and diagnostic policies.
- Define `SheetDefinition` including page dimensions, bubble centers/radii, question count/options, timing bands, QR/identity, registration fiducials, gray calibration, Test ID region and layout version.
- Build **three independent, versioned formats**: 50, 100, 150 questions. Each has actual printed sheet fixtures and photographed regression examples. Do not merely shrink the 50-question grid.
- No dynamic institute logo injection into scanner geometry in phase one. When OMR generation is added, render the page and scan from the *same versioned definition*.
- Scanner API goals: input(image, sheetDefinition, settings) -> validated ScanResult with 1 question-level decision per defined row and evidence. Reject unknown/incompatible templates.

## Identity, data model and tenant isolation

Recommendation for later implementation: PostgreSQL, managed auth (e.g., Supabase Auth), private object storage, Row Level Security and server-side authorization checks. This is a proposal, not a selected paid service.

Entities:
- users (global authentication identity)
- institutes (tenant ID, slug, lifecycle state, brand and subscription reference)
- memberships (user ID, tenant ID, role)
- students / batches / enrollments (tenant-scoped, external IDs if needed)
- sheet_definitions and template versions
- tests (tenant, sheet definition, marking policy, availability)
- answer_keys / answer_key_versions (tenant, test, state)
- submissions and file references (tenant, test, student, review status)
- detected_responses and manual_review_events (audit history)
- scoring_policy_versions / result_versions
- published_results / ranks / analytics aggregates
- billing subscriptions / usage events / audit logs

Rules:
- Hostname is **presentation/routing**, not authorization.
- Enforce tenant checks in server reads/writes and database RLS; never rely only on client-provided institute_id.
- One login may have different roles in multiple institutes.
- Use explicit public-vs-private data policy; do not expose student data by guessable exam IDs or result URLs.
- Avoid storing raw OMR photographs without a documented purpose, consent/contract basis, retention period and deletion controls.
- Signed access to private file objects; avoid leaking personal IDs or QR contents to diagnostics.
- Separate institute-provided answer keys and results; define approval/publication ownership.

## Release plan and acceptance

Phase 0 — Safety:
- Keep Vite v2.3 on `main` and GitHub Pages.
- Work only on `experiment/nextjs-multitenant-migration`.
- Capture stable 50-question golden input/output fixtures, including rotated/perspective and strict-invalid marks.

Phase 1 — Next.js shell (started):
- Independent `apps/web` Next.js App Router project.
- Responsive B2B marketing home, institute dashboard demo, two demo tenant routes.
- Initial `proxy.ts` hostname rewrite and scanner contract.
- No live authentication, student records or scanner integration claimed.

Phase 2 — Scanner parity (next):
- Port current 50-question scanner via browser-only adapter.
- Keep existing OpenCV.js, QR and calibration logic and 50/50 timing tests.
- Run same photo through Vite and Next and compare all 50 answers and diagnostic metrics.
- No new 100/150 sheets yet.

Phase 3 — Data and institute workflows:
- Introduce auth, tenant membership and tested RLS.
- Tests/answer keys -> submissions -> manual review -> scoring -> publication -> rankings.
- Start with two fictional test tenants and isolation tests.

Phase 4 — New templates:
- 100-question first, then 150-question geometry; printable sheets, captured-photo fixtures, calibration and rotated-image tests.

Phase 5 — Commercialization:
- Real institute onboarding, plans/usage tracking, billing, audit/retention controls, infrastructure monitoring, branded public portals and custom domains.

Deferred:
- Institute logo placement on generated OMR, complex Test ID conventions, advanced sheet designer, student direct-to-consumer subscriptions.

## Quality gates
- No merge to `main` until baseline scanner 50-question output parity and successful build/tests.
- Automated tests for tenant membership, authorization and cross-tenant access before any live customer data.
- Real mobile camera/upload scanning test with OpenCV loaded, plus OMR alignment and strict mark rejection regression.
- Never label mock metrics as actual student or institute data.
- Next.js dynamic SaaS cannot be hosted as a static GitHub Pages site; use appropriate Next.js hosting for previews and multi-tenant deployment.

## Immediate development checklist
- [x] Create migration branch
- [x] Commit architecture proposal
- [x] Create isolated Next.js shell with dashboard and demo tenant pages
- [x] Define scanner integration contract
- [ ] Pass Next.js type-check and production build in CI
- [ ] Establish 50-question golden fixtures
- [ ] Connect real v2.3 scanning to Next.js behind a client-only boundary
- [ ] Verify scan parity before moving more functionality
