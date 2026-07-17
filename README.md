# seo-graph

[![@iannuttall/seo-graph-core](https://img.shields.io/npm/v/%40iannuttall%2Fseo-graph-core?label=%40iannuttall%2Fseo-graph-core)](https://www.npmjs.com/package/@iannuttall/seo-graph-core)
[![@iannuttall/seo-graph-astro](https://img.shields.io/npm/v/%40iannuttall%2Fseo-graph-astro?label=%40iannuttall%2Fseo-graph-astro)](https://www.npmjs.com/package/@iannuttall/seo-graph-astro)
[![license](https://img.shields.io/github/license/iannuttall/seo-graph)](./LICENSE)

> Agent-ready SEO for JavaScript: schema.org JSON-LD graph builders, a
> deterministic agent-markdown pipeline, and HTTP content negotiation —
> with an Astro integration.

Sites are read by two audiences now. This toolkit serves both from one
place: typed schema.org `@graph` output for structured-data consumers, and
byte-stable Markdown representations of every page (with `llms.txt`, a
route manifest, IndexNow, and `Accept: text/markdown` negotiation) for AI
agents.

| Package | Purpose |
| --- | --- |
| [`@iannuttall/seo-graph-core`](./packages/core) | Pure, runtime-agnostic core. Schema piece builders and graph assembler (typed by [`schema-dts`](https://github.com/google/schema-dts)), the built-HTML → Markdown renderer with a strict content-selection contract, collection markdown rendering, route mapping, manifests, `llms.txt`, git-based lastmod, IndexNow hashing. |
| [`@iannuttall/seo-graph-astro`](./packages/astro) | Astro layer. `agentMarkdown()` build integration, collection markdown endpoints, schema endpoints + schema map, IndexNow key route, RFC 9727 api-catalog, Zod content helpers, and a Cloudflare Worker content-negotiation handler (`./cloudflare`). |

## Why not convert HTML at the edge?

Managed edge HTML→Markdown conversion has no exclusion contract: decorative
markup, `aria-hidden` card internals, and form labels leak into what agents
read, and you cannot fix it from your codebase. This pipeline runs at build
time against markup you own — decorative elements are stripped by contract
(`data-agent-markdown="exclude"`, `aria-hidden`, forms, nav), collection
pages serve their exact source Markdown, output is deterministic to the
byte, and violations can fail the build instead of shipping.

## Documentation

See [AGENTS.md](./AGENTS.md) for the full reference — schema builder
signatures, site-type recipes, the markdown content-selection contract, and
every integration surface. It's written for both humans and AI coding
agents (`CLAUDE.md` symlinks to it).

## Quick start (Astro)

```sh
pnpm add @iannuttall/seo-graph-astro @iannuttall/seo-graph-core
```

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import { agentMarkdown } from '@iannuttall/seo-graph-astro';

export default defineConfig({
    site: 'https://example.com',
    integrations: [agentMarkdown({ llmsTxt: { title: 'Example' } })],
});
```

## Develop

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

Releases publish from CI via [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
on `v*` tags.

## License

MIT © Ian Nuttall. Portions of the schema layer derive from
[jdevalk/seo-graph](https://github.com/jdevalk/seo-graph) by Joost de Valk
(MIT) — see [NOTICE](./NOTICE).
