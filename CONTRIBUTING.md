# Contributing

Questions, bugs, and proposals belong in
[GitHub Issues](https://github.com/iannuttall/seo-graph/issues). Search
existing issues first and keep one problem per issue.

For suspected vulnerabilities, use the private process in
[SECURITY.md](SECURITY.md). Never post tokens, API keys, private URLs, or
client data publicly.

## Before writing code

- Reproduce the problem with the smallest fixture you can.
- Schema changes should cite the relevant schema.org type or Google
  structured-data documentation.
- Markdown-pipeline changes must preserve the determinism contract: same
  inputs → identical bytes. See the contract in
  [packages/core/CONTRACT.md](packages/core/CONTRACT.md).

Large architecture changes should start with an issue. Small bug fixes can
go straight to a pull request.

## Local checks

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

Keep pull requests focused. Add or update tests for behavior changes, avoid
unrelated formatting, and use conventional commit subjects.

## Layering rule

Anything that is pure TypeScript belongs in `@iannuttall/seo-graph-core`.
Only genuinely framework-bound code (Astro `APIRoute` factories, build
hooks) belongs in a framework package. If a function's only framework tie
is a doc comment, it goes in core.

Contributions are licensed under MIT, as described in [LICENSE](LICENSE).
Portions derive from [jdevalk/seo-graph](https://github.com/jdevalk/seo-graph)
— see [NOTICE](NOTICE).
