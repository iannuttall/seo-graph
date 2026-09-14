# @iannuttall/seo-graph-astro

[![npm version](https://img.shields.io/npm/v/@iannuttall/seo-graph-astro)](https://www.npmjs.com/package/@iannuttall/seo-graph-astro)

Astro layer for
[`@iannuttall/seo-graph-core`](https://www.npmjs.com/package/@iannuttall/seo-graph-core):

- `agentMarkdown()` — build integration emitting a deterministic `.md` twin
  for every built content page, `agent-routes.json`, `llms.txt`, and injected
  alternate and `llms.txt` discovery links. One site can publish overlapping
  scoped files. Each page points to the most specific file that covers it.
  Builds also warn when a trailing-slash page moves from `/page.md` to the v2
  `/page/index.md` form. The warning does not change files or stop the build.
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
After you add redirects for old Markdown URLs, set
`agentMarkdown({ routeMigrationWarnings: false })` to hide the migration
warning.

```sh
pnpm add @iannuttall/seo-graph-astro @iannuttall/seo-graph-core
```

## Static Markdown headers

By default, `agentMarkdown()` appends this block to the build's `_headers`:

```text
# Generated agent markdown headers. Do not edit in build output.
/*.md
  ! Vary
  Content-Type: text/markdown; charset=utf-8
  Vary: Accept
```

Cloudflare's `*` also matches slashes, so this one rule covers `/post/slug.md`
and `/post/slug/index.md`. A separate `/*/index.md` rule is not needed.
With an Astro base of `/docs`, the pattern is `/docs/*.md`.

The default has no per-page canonical `Link` or `X-Markdown-Tokens` headers.
Each twin keeps its canonical URL in frontmatter. Token counts stay in
`agent-routes.json`.

When `llmsTxt` is set, each scope gets a `describedby` rule such as
`/docs/*.md`. A slashless scope root also gets `/docs.md` when that twin
exists. The root scope shares the main wildcard block. Scopes run from broad
to narrow and reset `Link`, so the most specific scope wins.

| `cloudflareHeaders` | Output |
| --- | --- |
| omitted or `true` | Wildcard rules, independent of page count. |
| `'per-page'` | One rule per twin, with canonical `Link`, optional `describedby`, and `X-Markdown-Tokens`. The build fails above 100 total rules, including existing site rules. |
| `false` | No `_headers` write. |

Existing site rules before the generated marker are kept. Repeated builds
replace the generated section and produce the same bytes. Cloudflare permits
[up to 100 rules per `_headers` file](https://developers.cloudflare.com/pages/configuration/headers/),
so allow room for site rules and scopes even in wildcard mode.

Full reference and recipes:
[AGENTS.md](https://github.com/iannuttall/seo-graph/blob/main/AGENTS.md).

MIT © Ian Nuttall. Portions derive from
[jdevalk/seo-graph](https://github.com/jdevalk/seo-graph) (MIT) — see NOTICE.
