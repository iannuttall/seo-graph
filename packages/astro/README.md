# @iannuttall/seo-graph-astro

[![npm version](https://img.shields.io/npm/v/@iannuttall/seo-graph-astro)](https://www.npmjs.com/package/@iannuttall/seo-graph-astro)

Astro layer for
[`@iannuttall/seo-graph-core`](https://www.npmjs.com/package/@iannuttall/seo-graph-core):

- `agentMarkdown()` — build integration emitting a deterministic `.md` twin
  for every built content page, `agent-routes.json`, `llms.txt`, and injected
  alternate and `llms.txt` discovery links. Scoped `llms.txt` and an optional
  `llms-full.txt` export are supported.
- `agentMarkdownMiddleware()` — live Markdown twins for `prerender = false`
  pages and opt-in `Accept: text/markdown` negotiation on any Astro adapter.
- `createMarkdownEndpoint()` — serve collection pages' Markdown from the
  source entry.
- `md` / `markdownResponse()` — small helpers for custom Markdown routes.
- `createSchemaEndpoint()` / `createSchemaMap()` — corpus-wide JSON-LD
  `@graph` endpoints and their discovery map.
- `createIndexNowKeyRoute()` + `indexNowOnBranch()` — IndexNow with
  preview-branch gating.
- `createApiCatalog()` — RFC 9727 `/.well-known/api-catalog`.
- `seoSchema` / `imageSchema` — Zod helpers for content collections.
- `@iannuttall/seo-graph-astro/cloudflare` —
  `createCloudflareMarkdownHandler()`, RFC 9110 `Accept: text/markdown`
  negotiation at canonical URLs for Cloudflare Workers.

Runtime negotiation is off by default. Static sites keep their current build
and hosting behavior. Enable the default package middleware with
`agentMarkdown({ runtimeMiddleware: true })`, or configure
`agentMarkdownMiddleware({ contentNegotiation: true })` in `src/middleware.ts`.

```sh
pnpm add @iannuttall/seo-graph-astro @iannuttall/seo-graph-core
```

Full reference and recipes:
[AGENTS.md](https://github.com/iannuttall/seo-graph/blob/main/AGENTS.md).

MIT © Ian Nuttall. Portions derive from
[jdevalk/seo-graph](https://github.com/jdevalk/seo-graph) (MIT) — see NOTICE.
