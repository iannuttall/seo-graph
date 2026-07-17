# Security

## Report a vulnerability

Do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting flow:

```txt
https://github.com/iannuttall/seo-graph/security/advisories/new
```

Include the affected package and API, clear reproduction steps, and the
practical impact. Remove tokens, API keys, private URLs, and client data
from every example.

Use [GitHub Issues](https://github.com/iannuttall/seo-graph/issues) for
ordinary questions and non-sensitive bugs.

## Scope notes

- The markdown renderer processes HTML you built yourself; it is not
  hardened against adversarial third-party HTML and must not be used as a
  general web-content extractor.
- The Cloudflare negotiation handler serves prebuilt static bytes; it never
  executes or transforms request bodies.
- IndexNow keys are not secrets in the credential sense (they are published
  at a public URL by design), but treat submission endpoints and any CI
  configuration around them with normal care.

## Maintainer checks

Before a release:

```sh
pnpm build
pnpm typecheck
pnpm test
gitleaks git . --no-banner
pnpm -r pack --dry-run
```

Releases publish from GitHub Actions via npm trusted publishing (OIDC) —
no long-lived npm tokens exist for these packages.
