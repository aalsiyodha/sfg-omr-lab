# Local-first development workflow

- `main` is the production branch. Do not push or merge there without explicit approval after local acceptance testing.
- Make all new changes on `test-build` or short-lived feature branches targeting `test-build`.
- Open Antigravity and check out the `test-build` branch locally.
- Run `npm ci`, `npm run build`, `npm run lint`, and `npm run test:scanner`.
- Run manual real-photo tests, compare scanner overlays and technical reports, and check mobile UI locally.
- Push `test-build` only after checks pass, so the test version is backed up on GitHub.
- Merge to `main` **only after the owner explicitly approves**; open a PR from `test-build` to `main`, review the diff, then merge.
- The Vercel setting for `test-build` disables automatic Git deployment for that branch. Other development branches may still trigger Vercel previews unless configured separately in Vercel project settings.
- The `public/robots.txt` file politely asks compliant crawlers not to index/crawl the app. It is not an anti-bot security mechanism.
- For actual abuse protection use Vercel Firewall/rate limiting, bot management or authentication as appropriate.
