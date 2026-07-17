# @iannuttall/seo-graph-core

[![npm version](https://img.shields.io/npm/v/@iannuttall/seo-graph-core)](https://www.npmjs.com/package/@iannuttall/seo-graph-core)

Pure, runtime-agnostic core for agent-ready SEO:

- **Schema graphs** — typed schema.org piece builders
  (`buildWebSite`, `buildWebPage`, `buildArticle`, `buildBreadcrumbList`,
  generic `buildPiece<T>` via [`schema-dts`](https://github.com/google/schema-dts)),
  `makeIds`, `assembleGraph`, `deduplicateByGraphId`, and the `aggregate`
  engine.
- **Agent markdown** — `renderAgentMarkdown` (deterministic built-HTML →
  Markdown with a strict content-selection contract, see
  [CONTRACT.md](./CONTRACT.md)), `renderMarkdownAlternate` (collection-source
  rendering), route mapping, `agent-routes.json` manifests, `llms.txt`,
  `gitLastmod`, and IndexNow submission + incremental manifest hashing.

```sh
pnpm add @iannuttall/seo-graph-core
```

Full reference, recipes, and integration guides live in the repo's
[AGENTS.md](https://github.com/iannuttall/seo-graph/blob/main/AGENTS.md).
For Astro projects, see
[`@iannuttall/seo-graph-astro`](https://www.npmjs.com/package/@iannuttall/seo-graph-astro).

MIT © Ian Nuttall. Portions derive from
[jdevalk/seo-graph](https://github.com/jdevalk/seo-graph) (MIT) — see NOTICE.
