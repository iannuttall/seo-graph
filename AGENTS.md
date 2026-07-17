# AGENTS.md — seo-graph

> This file is for AI coding agents (Claude Code, Cursor, Copilot, etc.)
> building sites that use `@iannuttall/seo-graph-core` and/or
> `@iannuttall/seo-graph-astro`. It explains what the library does, how the
> pieces fit together, and which schema.org entities to use for every
> common site type.

## What this library does

seo-graph makes a site legible to AI agents and search engines from one
toolkit, in two layers:

1. **Schema graphs.** Valid, linked schema.org JSON-LD `@graph` arrays from
   typed inputs. Instead of hand-writing JSON-LD (error-prone) or copying
   snippets from schema.org docs (inconsistent), you call piece builders that
   return strongly-typed entities, then wrap them in a `@graph` envelope.
2. **Agent markdown.** Deterministic Markdown representations of every page —
   rendered from the built HTML for arbitrary pages (with a strict exclusion
   contract so decorative markup never leaks) and straight from the source
   entry for content-collection pages — plus `llms.txt`, a route manifest,
   IndexNow, and an HTTP content-negotiation handler so agents can request
   `Accept: text/markdown` at the canonical URL.

Two packages:

- **`@iannuttall/seo-graph-core`** — Pure TypeScript, no framework
  dependency. Piece builders, ID factory, graph assembler, deduplication,
  the built-HTML → Markdown renderer, collection markdown renderer, route
  mapping, manifests, `llms.txt`, git-based lastmod, IndexNow manifest
  hashing. Use this from any runtime.
- **`@iannuttall/seo-graph-astro`** — Astro layer. `agentMarkdown()` build
  integration, collection markdown endpoints, schema endpoints and schema
  map, IndexNow key route, RFC 9727 api-catalog, Zod content helpers, and a
  Cloudflare Worker content-negotiation handler (`./cloudflare` subpath).

Portions of the schema layer derive from
[jdevalk/seo-graph](https://github.com/jdevalk/seo-graph) (MIT, see NOTICE).
The agent-markdown pipeline is original work first built for
[seoskill.dev](https://seoskill.dev).

---

## Contents

**Schema core** — concepts and builders for the JSON-LD graph:

- [Architecture](#architecture)
- [Installation](#installation)
- [The @id system](#the-id-system)
- [Piece builders reference](#piece-builders-reference)

**Recipes and patterns** — how to model real sites:

- [Site type recipes](#site-type-recipes)
- [Trust and credibility signals](#trust-and-credibility-signals)
- [Choosing the right Article subtype](#choosing-the-right-article-subtype)
- [Actions: telling agents what they can do](#actions-telling-agents-what-they-can-do)
- [Multi-type entities](#multi-type-entities)
- [Rich Organization patterns](#rich-organization-patterns)
- [Rich Person patterns](#rich-person-patterns)

**Agent markdown** — deterministic Markdown for every page:

- [The agent markdown pipeline](#the-agent-markdown-pipeline)
- [The content selection contract](#the-content-selection-contract)
- [Astro build integration](#astro-build-integration)
- [Collection markdown endpoints](#collection-markdown-endpoints)
- [Cloudflare content negotiation](#cloudflare-content-negotiation)

**Discovery surfaces** — endpoints agents can find and consume:

- [Schema endpoints and the schema map](#schema-endpoints-and-the-schema-map)
- [llms.txt and the route manifest](#llmstxt-and-the-route-manifest)
- [IndexNow](#indexnow)

**Reference:**

- [Common mistakes](#common-mistakes)
- [Validating your output](#validating-your-output)
- [Repository structure](#repository-structure)

---

## Architecture

```txt
┌────────────────────────────────────────────────────────────┐
│              @iannuttall/seo-graph-astro                   │
│  agentMarkdown()   createMarkdownEndpoint()                │
│  createSchemaEndpoint()  createSchemaMap()                 │
│  createIndexNowKeyRoute()  createApiCatalog()              │
│  seoSchema()/imageSchema()   ./cloudflare handler          │
└──────────────────────────┬─────────────────────────────────┘
                           │ builds on
┌──────────────────────────▼─────────────────────────────────┐
│              @iannuttall/seo-graph-core                    │
│                                                            │
│  Schema graph            Agent markdown                    │
│  ─────────────           ────────────────                  │
│  piece builders          renderAgentMarkdown (built HTML)  │
│  makeIds                 renderMarkdownAlternate (source)  │
│  assembleGraph           routes / manifests / llms.txt     │
│  deduplicateByGraphId    gitLastmod / IndexNow hashing     │
└────────────────────────────────────────────────────────────┘
```

Core is pure and framework-agnostic: a future `seo-graph-nextjs` (or
Eleventy, SvelteKit, Hono…) layer would sit beside the Astro package and
reuse everything in core. Anything that is pure TypeScript belongs in core;
only genuinely framework-bound code (Astro `APIRoute` factories, the build
hook) lives in the framework layer.

Markdown has two sources feeding one output contract:

- **Built-HTML path** — `agentMarkdown()` walks the final build output,
  selects the content root, strips excluded elements, and converts with
  Turndown + GFM. Covers every page, including ones that aren't backed by a
  collection (home, archives, tools).
- **Collection path** — `createMarkdownEndpoint()` serves Markdown straight
  from the content-collection entry: exact author intent, no conversion
  artifacts.

Both emit the same frontmatter shape, determinism guarantees, and token
estimates, so consumers cannot tell which path produced a page.

## Installation

```sh
pnpm add @iannuttall/seo-graph-core
# and, for Astro projects:
pnpm add @iannuttall/seo-graph-astro
```

`@iannuttall/seo-graph-core` is a direct dependency of the Astro package, so
it installs transitively — but depending on it explicitly lets you pin the
version and import builders directly. `astro` is an optional peer dependency:
non-Astro consumers of core never pull it.

## The @id system

Every entity in a JSON-LD `@graph` can have an `@id`. Other entities reference
it by `{ "@id": "..." }`. This is how the graph becomes _linked_ rather than
flat.

`makeIds()` creates an `IdFactory` that generates stable, deterministic `@id`
URIs for all entity types:

```ts
import { makeIds } from '@iannuttall/seo-graph-core';

const ids = makeIds({
    siteUrl: 'https://example.com',
    personUrl: 'https://example.com/about/', // optional, defaults to siteUrl + '/'
});
```

### Available IDs

| Property/Method          | Returns                                                  | Use for                              |
| ------------------------ | -------------------------------------------------------- | ------------------------------------ |
| `ids.person`             | `https://example.com/about/#/schema.org/Person`          | Site-wide Person entity              |
| `ids.personImage`        | `https://example.com/about/#/schema.org/Person/image`    | Person's profile image               |
| `ids.website`            | `https://example.com/#/schema.org/WebSite`               | Site-wide WebSite entity             |
| `ids.navigation`         | `https://example.com/#/schema.org/SiteNavigationElement` | Main navigation                      |
| `ids.organization(slug)` | `https://example.com/#/schema.org/Organization/{slug}`   | Named organization                   |
| `ids.country(code)`      | `https://example.com/#/schema.org/Country/{code}`        | Country entity (ISO 3166)            |
| `ids.webPage(url)`       | The URL itself                                           | WebPage entity (canonical URL = @id) |
| `ids.breadcrumb(url)`    | `{url}#breadcrumb`                                       | BreadcrumbList for a page            |
| `ids.article(url)`       | `{url}#article`                                          | Article entity for a page            |
| `ids.videoObject(url)`   | `{url}#video`                                            | VideoObject for a page               |
| `ids.primaryImage(url)`  | `{url}#primaryimage`                                     | Primary image for a page             |

### How entities reference each other

Entities form a tree of references:

```
WebSite
  ├── publisher → Person or Organization
  ├── hasPart → SiteNavigationElement
  │
  ├── Blog (optional, for sites with a blog)
  │     └── publisher → Person or Organization
  │
  └── WebPage (one per URL)
        ├── isPartOf → WebSite
        ├── breadcrumb → BreadcrumbList
        ├── primaryImage → ImageObject
        │
        ├── BlogPosting or Article (if blog post)
        │     ├── isPartOf → WebPage, Blog
        │     ├── author → Person
        │     ├── publisher → Person or Organization
        │     └── image → ImageObject
        │
        └── VideoObject (if video page)
              └── isPartOf → WebPage
```

**Blog vs. Article hierarchy:** `Blog` is a `CreativeWork` that represents the
blog as a publication. `BlogPosting` is a subtype of `Article`. A `BlogPosting`
can be `isPartOf` both its `WebPage` and the `Blog`. This lets agents understand
that a post belongs to a specific blog, not just a website. Use `Blog` when the
site has a distinct blog section; skip it for single-purpose blogs where the
blog _is_ the site.

**Rule:** Always use `{ '@id': ids.xxx }` to reference another entity. Never
inline the full entity inside another entity. The graph structure handles
resolution.

---

## Piece builders reference

Every builder takes an input object and returns a `GraphEntity` (a plain object
with `@type` and usually `@id`). The specialized builders (`buildWebSite`,
`buildWebPage`, `buildArticle`, etc.) also take the `IdFactory` as a second
parameter. The generic `buildPiece` builder takes only the input object — you
set the `@id` directly in the input.

### buildWebSite

Creates the site-wide `WebSite` entity. Include exactly once per graph.

```ts
buildWebSite(
    {
        url: 'https://example.com/', // required — site root URL
        name: 'My Site', // required — site name
        description: 'A site about...', // optional
        publisher: { '@id': ids.person }, // required — Person or Organization ref
        about: { '@id': ids.person }, // optional — what this site is about
        inLanguage: 'en-US', // optional — default content language
        hasPart: { '@id': ids.navigation }, // optional — navigation ref
        // ...additional schema-dts properties accepted at top level
    },
    ids,
);
```

**Adding a SearchAction** (recommended for sites with search):

Add a `potentialAction` with a `SearchAction` directly at the top level. This
tells search engines and agents how to search your site:

```ts
buildWebSite(
    {
        url: 'https://example.com/',
        name: 'My Site',
        publisher: { '@id': ids.person },
        potentialAction: {
            '@type': 'SearchAction',
            target: {
                '@type': 'EntryPoint',
                urlTemplate: 'https://example.com/?s={search_term_string}',
            },
            'query-input': {
                '@type': 'PropertyValueSpecification',
                valueRequired: true,
                valueName: 'search_term_string',
            },
        },
    },
    ids,
);
```

This is the pattern used by most WordPress sites and many other CMSes.

### buildWebPage

Creates a `WebPage`, `ProfilePage`, or `CollectionPage` entity.

```ts
buildWebPage(
    {
        url: 'https://example.com/my-page/', // required — canonical URL (becomes @id)
        name: 'My Page', // required — page title
        isPartOf: { '@id': ids.website }, // required — WebSite ref
        breadcrumb: { '@id': ids.breadcrumb(url) }, // optional — BreadcrumbList ref
        inLanguage: 'en-US', // optional
        datePublished: new Date('2026-01-15'), // optional — emitted as ISO string
        dateModified: new Date('2026-03-01'), // optional
        primaryImage: { '@id': ids.primaryImage(url) }, // optional — ImageObject ref
        about: { '@id': ids.person }, // optional — for ProfilePage/homepage
        copyrightHolder: { '@id': ids.person }, // optional — who holds the copyright
        copyrightYear: 2026, // optional
        copyrightNotice: '© 2026 Jane Doe.', // optional — human-readable copyright text
        license: 'https://creativecommons.org/licenses/by/4.0/', // optional — license URL
        isAccessibleForFree: true, // optional
        potentialAction: [], // optional — defaults to ReadAction
        // ...additional schema-dts properties accepted at top level
    },
    ids,
    'WebPage',
); // third param: 'WebPage' | 'ProfilePage' | 'CollectionPage'
```

**When to use which type:**

- `WebPage` — Default. Blog posts, regular pages, product pages.
- `ProfilePage` — About pages, author profiles.
- `CollectionPage` — Blog listing, category archives, tag pages, portfolios.

### buildArticle

Creates an `Article` or any Article subtype (`BlogPosting`, `NewsArticle`,
etc.). Use for blog posts, news articles, tutorials.

```ts
buildArticle(
    {
        url: 'https://example.com/my-post/', // required — canonical URL
        isPartOf: { '@id': ids.webPage(url) }, // required — enclosing WebPage ref
        author: { '@id': ids.person }, // required — Person ref
        publisher: { '@id': ids.person }, // required — Person or Organization ref
        headline: 'My Post Title', // required
        description: 'A brief summary...', // required
        inLanguage: 'en-US', // optional
        datePublished: new Date('2026-01-15'), // required
        dateModified: new Date('2026-03-01'), // optional
        image: { '@id': ids.primaryImage(url) }, // optional — ImageObject ref
        about: { '@id': ids.person }, // optional — what this article is about
        articleSection: 'Technology', // optional — top-level category
        wordCount: 1500, // optional
        articleBody: 'The full text...', // optional — plain text, max ~10K chars
        // ...additional schema-dts properties accepted at top level
    },
    ids,
    'Article',
); // third param: 'Article' | 'BlogPosting' | 'NewsArticle' | 'TechArticle' | 'ScholarlyArticle' | 'Report'
```

**The `type` parameter:** Pass the schema.org type name as the third argument.
Defaults to `'Article'`. Use `'BlogPosting'` for blog posts, `'NewsArticle'`
for journalism, `'TechArticle'` for technical docs, `'ScholarlyArticle'` for
academic papers, or `'Report'` for data/research reports.

````

### buildBreadcrumbList

Creates a `BreadcrumbList` with nested `ListItem` entries.

```ts
buildBreadcrumbList({
    url: 'https://example.com/blog/my-post/', // required — page this belongs to
    items: [                                   // required — ordered root-first
        { name: 'Home', url: 'https://example.com/' },
        { name: 'Blog', url: 'https://example.com/blog/' },
        { name: 'My Post', url: 'https://example.com/blog/my-post/' },
    ],
    // ...additional schema-dts properties accepted at top level
}, ids);
````

**Rules:**

- First item should be the homepage.
- Last item should be the current page.
- Order is root → leaf.

### buildImageObject

Creates an `ImageObject` entity.

```ts
// Page-specific image (e.g. blog post feature image)
buildImageObject(
    {
        pageUrl: 'https://example.com/my-post/', // one of pageUrl or id required
        url: 'https://example.com/images/post.jpg', // required — image file URL
        width: 1200, // required
        height: 630, // required
        inLanguage: 'en-US', // optional
        caption: 'A photo of...', // optional
        // ...additional schema-dts properties accepted at top level
    },
    ids,
);

// Site-wide image (e.g. person photo, logo)
buildImageObject(
    {
        id: ids.personImage, // explicit @id override
        url: 'https://example.com/joost.jpg',
        width: 400,
        height: 400,
    },
    ids,
);
```

### buildVideoObject

Creates a `VideoObject` entity. Has built-in YouTube support.

```ts
buildVideoObject(
    {
        url: 'https://example.com/videos/my-talk/', // required — page URL
        name: 'My Conference Talk', // required
        description: 'A talk about...', // required
        isPartOf: { '@id': ids.webPage(url) }, // required — enclosing WebPage ref
        youtubeId: 'dQw4w9WgXcQ', // optional — auto-derives thumbnail + embed URLs
        thumbnailUrl: '...', // optional — explicit override
        embedUrl: '...', // optional — explicit override
        uploadDate: new Date('2026-01-15'), // optional
        duration: 'PT30M', // optional — ISO 8601
        transcript: 'Full transcript text...', // optional
        // ...additional schema-dts properties accepted at top level
    },
    ids,
);
```

**YouTube convenience:** When `youtubeId` is provided:

- `thumbnailUrl` defaults to `https://img.youtube.com/vi/{id}/maxresdefault.jpg`
- `embedUrl` defaults to `https://www.youtube-nocookie.com/embed/{id}`

### buildSiteNavigationElement

Creates a `SiteNavigationElement` with nested items.

```ts
buildSiteNavigationElement(
    {
        name: 'Main navigation', // required
        isPartOf: { '@id': ids.website }, // required — WebSite ref
        items: [
            // required — navigation links
            { name: 'Home', url: 'https://example.com/' },
            { name: 'Blog', url: 'https://example.com/blog/' },
            { name: 'About', url: 'https://example.com/about/' },
        ],
        // ...additional schema-dts properties accepted at top level
    },
    ids,
);
```

### buildPiece

The generic typed builder for any schema.org type. This is the go-to builder
for `Person`, `Organization`, `Blog`, `Product`, `Recipe`, `Event`, `Course`,
`SoftwareApplication`, `VacationRental`, `FAQPage`, `PodcastSeries`,
`PodcastEpisode`, and any other schema.org type not covered by the specialized
builders (`buildWebSite`, `buildWebPage`, `buildArticle`, etc.).

Pass a `schema-dts` type as the generic parameter for full autocomplete.
The `@type` value in the input narrows union types to the matching leaf — so
`buildPiece<Product>` with `'@type': 'Product'` gives `ProductLeaf` autocomplete.
No need to import Leaf types separately.

Callers are responsible for setting `@id` using the `IdFactory` (e.g.
`ids.person`, `ids.organization('slug')`) or a custom ID string.

```ts
import type { Person, Organization, Restaurant, Blog, Product, Recipe, Event } from 'schema-dts';

// Person (site-wide)
buildPiece<Person>({
    '@type': 'Person',
    '@id': ids.person,
    name: 'Jane Doe',
    url: 'https://example.com/about/',
    image: { '@id': ids.personImage },
    sameAs: ['https://twitter.com/janedoe', 'https://github.com/janedoe'],
    jobTitle: 'Lead Engineer',
    worksFor: [
        {
            '@type': 'EmployeeRole',
            roleName: 'Lead Engineer',
            startDate: '2022-01-01',
            worksFor: { '@id': ids.organization('acme') },
        },
    ],
});

// Organization
buildPiece<Organization>({
    '@type': 'Organization',
    '@id': ids.organization('acme'),
    name: 'Acme Corp',
    url: 'https://acme.com/',
    logo: 'https://acme.com/logo.png',
    sameAs: ['https://twitter.com/acme'],
});

// Organization subtype (e.g. Restaurant) — use the subtype directly as the generic
buildPiece<Restaurant>({
    '@type': 'Restaurant',
    '@id': ids.organization('chez-example'),
    name: 'Chez Example',
    url: 'https://chezexample.com/',
    servesCuisine: 'French',
    priceRange: '$$$',
    address: {
        '@type': 'PostalAddress',
        streetAddress: '123 Rue de la Paix',
        addressLocality: 'Paris',
        addressCountry: 'FR',
    },
});

// Product
buildPiece<Product>({
    '@type': 'Product',
    '@id': `${url}#product`,
    name: 'Running Shoe',
    brand: 'Nike',
    sku: 'ABC123',
    offers: { '@type': 'Offer', price: 99.99, priceCurrency: 'USD' },
});

// Blog
buildPiece<Blog>({
    '@type': 'Blog',
    '@id': `${siteUrl}/blog/#blog`,
    name: 'My Blog',
    url: `${siteUrl}/blog/`,
    publisher: { '@id': ids.person },
    inLanguage: 'en-US',
});

// Recipe
buildPiece<Recipe>({
    '@type': 'Recipe',
    '@id': `${url}#recipe`,
    name: 'Simple Pasta',
    author: { '@id': ids.person },
    prepTime: 'PT10M',
    cookTime: 'PT20M',
    totalTime: 'PT30M',
    recipeYield: '4 servings',
    recipeCategory: 'Main course',
    recipeCuisine: 'Italian',
    recipeIngredient: ['400g spaghetti', '200g guanciale', '4 egg yolks'],
    recipeInstructions: [
        { '@type': 'HowToStep', text: 'Boil the spaghetti.' },
        { '@type': 'HowToStep', text: 'Fry the guanciale.' },
    ],
});

// Event
buildPiece<Event>({
    '@type': 'Event',
    '@id': 'https://example.com/events/conf/#event',
    name: 'JavaScript Conference 2026',
    startDate: '2026-09-15T09:00:00+02:00',
    endDate: '2026-09-17T18:00:00+02:00',
    location: {
        '@type': 'Place',
        name: 'Congress Center',
    },
});
```

Without a generic, the input is untyped — any properties are accepted:

```ts
buildPiece({
    '@type': 'Event',
    '@id': 'https://example.com/events/conf/#event',
    name: 'JavaScript Conference 2026',
});
```

**Always prefer the typed generic** (`buildPiece<Event>`) over the
untyped form. The generic gives you autocomplete for every property on the
chosen type, making it much harder to miss recommended fields like
`potentialAction`, `geo`, or `offers`.

### Overriding `@id`

Every dedicated builder computes an `@id` from the `IdFactory` (e.g.
`ids.website`, `ids.article(url)`). You can override it by passing `'@id'`
directly — the explicit value wins:

```ts
buildBreadcrumbList(
    {
        url,
        items: [
            { name: 'Home', url: siteUrl },
            { name: 'Blog', url: blogUrl },
        ],
        '@id': `${blogUrl}#breadcrumb`, // overrides ids.breadcrumb(url)
    },
    ids,
);
```

This works on all builders: `buildWebSite`, `buildWebPage`, `buildArticle`,
`buildBreadcrumbList`, `buildImageObject`, `buildVideoObject`, and
`buildSiteNavigationElement`.

### assembleGraph

Wraps pieces in a `{ "@context": "https://schema.org", "@graph": [...] }`
envelope with first-wins deduplication by `@id`.

```ts
import { assembleGraph } from '@iannuttall/seo-graph-core';

const graph = assembleGraph([
    websitePiece,
    personPiece,
    webPagePiece,
    articlePiece,
    breadcrumbPiece,
]);
```

**Always call this last.** It handles deduplication: if multiple pages produce
the same `WebSite` or `Person` entity (same `@id`), the first occurrence wins.

**Dangling reference validation:** Pass `warnOnDanglingReferences: true` to
validate that every `{ '@id': '...' }` reference in the graph resolves to an
actual entity. This helps catch broken links — for example, a `WebSite`
referencing a `Person` that was never included in the pieces array.

```ts
const graph = assembleGraph(pieces, { warnOnDanglingReferences: true });
// Warns: [seo-graph] Dangling reference in WebSite: { "@id": "..." } does not match any entity in the graph.
```

### deduplicateByGraphId

The dedup engine on its own, for custom assembly workflows.

```ts
import { deduplicateByGraphId } from '@iannuttall/seo-graph-core';

const unique = deduplicateByGraphId(allPieces);
```

---

## Site type recipes

Each recipe shows which pieces to include for a given page type. Copy the
pattern, adjust the data. Every recipe assumes you've already created an
`IdFactory` with `makeIds()`.

### Personal blog

The most common case. A single-author blog with posts, categories, and an
about page.

**For every page** (site-wide entities):

- `buildWebSite` — publisher points to Person
- `buildPiece<Person>` — the blog author
- `buildImageObject` — person's profile photo (use `id: ids.personImage`)
- `buildPiece<Blog>` — a `Blog` entity representing the blog as a publication

The `Blog` entity is a `CreativeWork` that represents the blog as a whole,
separate from the `WebSite`. Individual `BlogPosting` entries reference the
Blog via `isPartOf`. This is the pattern used by jonoalderson.com.

```ts
import type { Blog } from 'schema-dts';

const blogId = `${siteUrl}/blog/#blog`;

// Include on every page as a site-wide entity
buildPiece<Blog>({
    '@type': 'Blog',
    '@id': blogId,
    name: 'My Blog',
    description: 'Thoughts on web development and the open web.',
    url: `${siteUrl}/blog/`,
    publisher: { '@id': ids.person },
    inLanguage: 'en-US',
}),
```

**Blog post** (`/blog/my-post/`):

Use `BlogPosting` instead of `Article` and link it to the Blog:

```ts
import type { Person, Blog } from 'schema-dts';

const blogId = `${siteUrl}/blog/#blog`;

const pieces = [
    buildWebSite({ url: siteUrl, name: 'My Blog', publisher: { '@id': ids.person } }, ids),
    buildPiece<Person>({ '@type': 'Person', '@id': ids.person, name: 'Jane Doe', url: aboutUrl, image: { '@id': ids.personImage }, sameAs: [...] }),
    buildImageObject({ id: ids.personImage, url: profilePhotoUrl, width: 400, height: 400 }, ids),
    buildPiece<Blog>({
        '@type': 'Blog',
        '@id': blogId,
        name: 'My Blog',
        url: `${siteUrl}/blog/`,
        publisher: { '@id': ids.person },
    }),
    buildWebPage({ url, name: title, isPartOf: { '@id': ids.website }, breadcrumb: { '@id': ids.breadcrumb(url) }, datePublished, dateModified, primaryImage: { '@id': ids.primaryImage(url) } }, ids),
    buildArticle({
        url,
        headline: title,
        description,
        datePublished,
        dateModified,
        author: { '@id': ids.person },
        publisher: { '@id': ids.person },
        isPartOf: [{ '@id': ids.webPage(url) }, { '@id': blogId }],
        image: { '@id': ids.primaryImage(url) },
        articleSection: category,
        wordCount,
    }, ids, 'BlogPosting'),
    buildBreadcrumbList({ url, items: [{ name: 'Home', url: siteUrl }, { name: 'Blog', url: blogUrl }, { name: title, url }] }, ids),
    buildImageObject({ pageUrl: url, url: featureImageUrl, width: 1200, height: 630 }, ids),
];
const graph = assembleGraph(pieces);
```

**Note:** The `isPartOf` array links the posting to both the `WebPage` and the
`Blog`. If you don't need the `Blog` link, just use
`isPartOf: { '@id': ids.webPage(url) }` directly.

**Blog listing** (`/blog/`):

```ts
const pieces = [
    // ...site-wide entities (including Blog)...
    buildWebPage(
        {
            url,
            name: 'Blog',
            isPartOf: { '@id': ids.website },
            breadcrumb: { '@id': ids.breadcrumb(url) },
            about: { '@id': blogId },
        },
        ids,
        'CollectionPage',
    ),
    buildBreadcrumbList(
        {
            url,
            items: [
                { name: 'Home', url: siteUrl },
                { name: 'Blog', url },
            ],
        },
        ids,
    ),
];
```

**Category archive** (`/blog/category/tech/`):

```ts
const pieces = [
    // ...site-wide entities...
    buildWebPage(
        {
            url,
            name: 'Technology',
            isPartOf: { '@id': ids.website },
            breadcrumb: { '@id': ids.breadcrumb(url) },
        },
        ids,
        'CollectionPage',
    ),
    buildBreadcrumbList(
        {
            url,
            items: [
                { name: 'Home', url: siteUrl },
                { name: 'Blog', url: blogUrl },
                { name: 'Technology', url },
            ],
        },
        ids,
    ),
];
```

**About page** (`/about/`):

```ts
const pieces = [
    // ...site-wide entities...
    buildWebPage(
        { url, name: 'About Jane', isPartOf: { '@id': ids.website }, about: { '@id': ids.person } },
        ids,
        'ProfilePage',
    ),
];
```

**Homepage** (`/`):

```ts
const pieces = [
    // ...site-wide entities...
    buildWebPage(
        {
            url: siteUrl,
            name: 'Jane Doe — My Blog',
            isPartOf: { '@id': ids.website },
            about: { '@id': ids.person },
        },
        ids,
        'CollectionPage',
    ),
];
```

---

### Business / company blog

A multi-author blog owned by a company.

**Key difference from personal blog:** The `WebSite` publisher is an
`Organization`, not a `Person`. Individual authors are separate `Person`
entities.

```ts
import type { Organization, Blog, Person } from 'schema-dts';

const ids = makeIds({ siteUrl: 'https://acme.com' });

// Site-wide
const blogId = 'https://acme.com/blog/#blog';
const siteEntities = [
    buildPiece<Organization>({ '@type': 'Organization', '@id': ids.organization('acme'), name: 'Acme Corp', url: 'https://acme.com/', logo: logoUrl, sameAs: [...] }),
    buildWebSite({ url: 'https://acme.com/', name: 'Acme Blog', publisher: { '@id': ids.organization('acme') } }, ids),
    buildPiece<Blog>({
        '@type': 'Blog',
        '@id': blogId,
        name: 'The Acme Blog',
        url: 'https://acme.com/blog/',
        publisher: { '@id': ids.organization('acme') },
    }),
];

// Per blog post — author is a separate Person (not site-wide ids.person)
const authorId = 'https://acme.com/team/jane/#person';
const postPieces = [
    ...siteEntities,
    buildPiece<Person>({ '@type': 'Person', '@id': authorId, name: 'Jane Doe', url: 'https://acme.com/team/jane/' }),
    buildWebPage({ url, name: title, isPartOf: { '@id': ids.website }, datePublished }, ids),
    buildArticle({
        url,
        headline: title,
        description,
        datePublished,
        author: { '@id': authorId },
        publisher: { '@id': ids.organization('acme') },
        isPartOf: [{ '@id': ids.webPage(url) }, { '@id': blogId }],
    }, ids, 'BlogPosting'),
    buildBreadcrumbList({ url, items: [{ name: 'Home', url: siteUrl }, { name: 'Blog', url: blogUrl }, { name: title, url }] }, ids),
];
```

---

### E-commerce / product page

Use `buildPiece<Product>` for `Product` and `buildPiece<ProductGroup>` for `ProductGroup` entities.

**Simple product (single variant):**

```ts
import type { Organization, Product } from 'schema-dts';

const ids = makeIds({ siteUrl: 'https://shop.example.com' });

const pieces = [
    buildPiece<Organization>({
        '@type': 'Organization',
        '@id': ids.organization('shop'),
        name: 'Example Shop',
        url: siteUrl,
        logo: logoUrl,
    }),
    buildWebSite(
        { url: siteUrl, name: 'Example Shop', publisher: { '@id': ids.organization('shop') } },
        ids,
    ),
    buildWebPage(
        {
            url,
            name: productName,
            isPartOf: { '@id': ids.website },
            breadcrumb: { '@id': ids.breadcrumb(url) },
        },
        ids,
    ),
    buildBreadcrumbList(
        {
            url,
            items: [
                { name: 'Home', url: siteUrl },
                { name: 'Shoes', url: categoryUrl },
                { name: productName, url },
            ],
        },
        ids,
    ),
    buildPiece<Product>({
        '@type': 'Product',
        '@id': `${url}#product`,
        name: productName,
        description: productDescription,
        brand: 'Nike',
        sku: 'ABC123',
        offers: {
            '@type': 'Offer',
            price: 99.99,
            priceCurrency: 'USD',
            availability: 'https://schema.org/InStock',
            url,
            seller: { '@id': ids.organization('shop') },
        },
        aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: 4.5,
            reviewCount: 42,
        },
        potentialAction: {
            '@type': 'BuyAction',
            target: {
                '@type': 'EntryPoint',
                urlTemplate: 'https://shop.example.com/cart/add/{sku}',
            },
            seller: { '@id': ids.organization('shop') },
        },
        image: productImageUrl,
    }),
];
```

**Product with variants** (sizes, colors — see meta.com for a live example):

When a product has multiple variants (e.g. sizes, colors), use `ProductGroup`
as the parent and individual `Product` entities for each variant:

```ts
import type { Product, ProductGroup } from 'schema-dts';

const variants = [
    {
        sku: 'SHOE-BLK-10',
        name: 'Running Shoe — Black, Size 10',
        color: 'Black',
        size: '10',
        price: 99.99,
        inStock: true,
    },
    {
        sku: 'SHOE-WHT-10',
        name: 'Running Shoe — White, Size 10',
        color: 'White',
        size: '10',
        price: 99.99,
        inStock: true,
    },
    {
        sku: 'SHOE-BLK-11',
        name: 'Running Shoe — Black, Size 11',
        color: 'Black',
        size: '11',
        price: 99.99,
        inStock: false,
    },
];

const pieces = [
    // ...site-wide + WebPage + BreadcrumbList...
    buildPiece<ProductGroup>({
        '@type': 'ProductGroup',
        '@id': `${url}#product`,
        name: 'Running Shoe',
        description: productDescription,
        brand: 'Nike',
        url,
        productGroupID: 'running-shoe',
        variesBy: ['https://schema.org/color', 'https://schema.org/size'],
        hasVariant: variants.map((v) => ({ '@id': `${url}#product-${v.sku}` })),
    }),
    ...variants.map((v) =>
        buildPiece<Product>({
            '@type': 'Product',
            '@id': `${url}#product-${v.sku}`,
            name: v.name,
            sku: v.sku,
            offers: {
                '@type': 'Offer',
                price: v.price,
                priceCurrency: 'USD',
                availability: v.inStock
                    ? 'https://schema.org/InStock'
                    : 'https://schema.org/OutOfStock',
                url,
                hasMerchantReturnPolicy: {
                    '@type': 'MerchantReturnPolicy',
                    merchantReturnDays: 30,
                    returnMethod: 'https://schema.org/ReturnByMail',
                    returnFees: 'https://schema.org/FreeReturn',
                },
                shippingDetails: {
                    '@type': 'OfferShippingDetails',
                    shippingRate: { '@type': 'MonetaryAmount', value: 0, currency: 'USD' },
                    shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'US' },
                },
            },
            color: v.color,
            size: v.size,
            image: [productImageUrl],
        }),
    ),
];
```

---

### Local business

A restaurant, dentist, shop, or any business with a physical location.

```ts
import type { Restaurant } from 'schema-dts';

const ids = makeIds({ siteUrl: 'https://chezexample.com' });

const pieces = [
    buildPiece<Restaurant>({
        '@type': 'Restaurant',
        '@id': ids.organization('chez-example'),
        name: 'Chez Example',
        url: 'https://chezexample.com/',
        logo: logoUrl,
        sameAs: ['https://instagram.com/chezexample'],
        address: {
            '@type': 'PostalAddress',
            streetAddress: '123 Rue de la Paix',
            addressLocality: 'Paris',
            postalCode: '75002',
            addressCountry: 'FR',
        },
        telephone: '+33-1-23-45-67-89',
        priceRange: '$$$',
        servesCuisine: 'French',
        geo: {
            '@type': 'GeoCoordinates',
            latitude: 48.8698,
            longitude: 2.3311,
        },
        openingHoursSpecification: [
            {
                '@type': 'OpeningHoursSpecification',
                dayOfWeek: ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
                opens: '12:00',
                closes: '14:30',
            },
            {
                '@type': 'OpeningHoursSpecification',
                dayOfWeek: ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
                opens: '19:00',
                closes: '22:30',
            },
        ],
    }),
    buildWebSite(
        {
            url: siteUrl,
            name: 'Chez Example',
            publisher: { '@id': ids.organization('chez-example') },
        },
        ids,
    ),
    buildWebPage(
        {
            url: siteUrl,
            name: 'Chez Example — French Restaurant in Paris',
            isPartOf: { '@id': ids.website },
        },
        ids,
    ),
];
```

---

### Portfolio / agency

A freelancer or agency showcasing work.

```ts
import type { Person } from 'schema-dts';

const ids = makeIds({ siteUrl: 'https://janedoe.design' });

// Homepage — CollectionPage showcasing work
const pieces = [
    buildPiece<Person>({
        '@type': 'Person',
        '@id': ids.person,
        name: 'Jane Doe',
        jobTitle: 'Product Designer',
        url: siteUrl,
        image: { '@id': ids.personImage },
        sameAs: [dribbble, linkedin],
    }),
    buildImageObject({ id: ids.personImage, url: headshot, width: 400, height: 400 }, ids),
    buildWebSite({ url: siteUrl, name: 'Jane Doe Design', publisher: { '@id': ids.person } }, ids),
    buildWebPage(
        {
            url: siteUrl,
            name: 'Jane Doe — Product Designer',
            isPartOf: { '@id': ids.website },
            about: { '@id': ids.person },
        },
        ids,
        'CollectionPage',
    ),
];

// Individual project page
const projectPieces = [
    // ...site-wide entities...
    buildWebPage(
        {
            url,
            name: projectTitle,
            isPartOf: { '@id': ids.website },
            breadcrumb: { '@id': ids.breadcrumb(url) },
            datePublished,
        },
        ids,
    ),
    buildArticle(
        {
            url,
            isPartOf: { '@id': ids.webPage(url) },
            author: { '@id': ids.person },
            publisher: { '@id': ids.person },
            headline: projectTitle,
            description,
            datePublished,
        },
        ids,
    ),
    buildBreadcrumbList(
        {
            url,
            items: [
                { name: 'Home', url: siteUrl },
                { name: 'Work', url: workUrl },
                { name: projectTitle, url },
            ],
        },
        ids,
    ),
];
```

---

### Documentation site

A docs site for a software project or API.

```ts
import type { Organization } from 'schema-dts';

const ids = makeIds({ siteUrl: 'https://docs.example.com' });

const pieces = [
    buildPiece<Organization>({
        '@type': 'Organization',
        '@id': ids.organization('example'),
        name: 'Example Inc',
        url: 'https://example.com/',
        logo: logoUrl,
    }),
    buildWebSite(
        {
            url: siteUrl,
            name: 'Example Docs',
            publisher: { '@id': ids.organization('example') },
            description: 'Documentation for Example SDK',
        },
        ids,
    ),
    buildWebPage(
        {
            url,
            name: pageTitle,
            isPartOf: { '@id': ids.website },
            breadcrumb: { '@id': ids.breadcrumb(url) },
            dateModified,
        },
        ids,
    ),
    buildBreadcrumbList(
        {
            url,
            items: [
                { name: 'Docs', url: siteUrl },
                { name: 'Guides', url: guidesUrl },
                { name: pageTitle, url },
            ],
        },
        ids,
    ),
];
```

For docs, `Article` is optional. Many documentation pages are better served by
just `WebPage` + `BreadcrumbList`. Add `Article` only for tutorial-style content
with a clear author and publish date.

---

### Podcast / video site

Just as `Blog` is a container for `BlogPosting`, `PodcastSeries` is a
container for `PodcastEpisode`. Include the series as a site-wide entity.

**Video podcast (YouTube-based):**

```ts
import type { Person, PodcastSeries } from 'schema-dts';

const ids = makeIds({ siteUrl: 'https://podcast.example.com' });
const seriesId = `${siteUrl}#podcast-series`;

// Episode page
const pieces = [
    buildPiece<Person>({
        '@type': 'Person',
        '@id': ids.person,
        name: 'Host Name',
        url: aboutUrl,
        image: { '@id': ids.personImage },
    }),
    buildImageObject({ id: ids.personImage, url: hostPhotoUrl, width: 400, height: 400 }, ids),
    buildWebSite({ url: siteUrl, name: 'My Podcast', publisher: { '@id': ids.person } }, ids),
    buildPiece<PodcastSeries>({
        '@type': 'PodcastSeries',
        '@id': seriesId,
        name: 'My Podcast',
        description: 'A weekly show about...',
        url: siteUrl,
        author: { '@id': ids.person },
        publisher: { '@id': ids.person },
        inLanguage: 'en-US',
        webFeed: `${siteUrl}feed.xml`,
    }),
    buildWebPage(
        {
            url,
            name: episodeTitle,
            isPartOf: { '@id': ids.website },
            breadcrumb: { '@id': ids.breadcrumb(url) },
            datePublished,
        },
        ids,
    ),
    buildVideoObject(
        {
            url,
            name: episodeTitle,
            description: episodeDescription,
            isPartOf: { '@id': ids.webPage(url) },
            youtubeId,
            uploadDate: publishDate,
            duration: 'PT45M',
            transcript,
        },
        ids,
    ),
    buildBreadcrumbList(
        {
            url,
            items: [
                { name: 'Home', url: siteUrl },
                { name: 'Episodes', url: episodesUrl },
                { name: episodeTitle, url },
            ],
        },
        ids,
    ),
];
```

**Audio-only podcast:**

Use `PodcastEpisode` linked to the `PodcastSeries`:

```ts
import type { PodcastEpisode } from 'schema-dts';

const seriesId = `${siteUrl}#podcast-series`;

const pieces = [
    // ...site-wide entities including PodcastSeries...
    buildWebPage({ url, name: episodeTitle, isPartOf: { '@id': ids.website }, datePublished }, ids),
    buildPiece<PodcastEpisode>({
        '@type': 'PodcastEpisode',
        '@id': `${url}#episode`,
        name: episodeTitle,
        description: episodeDescription,
        url,
        datePublished: publishDate.toISOString(),
        duration: 'PT45M',
        episodeNumber: 42,
        partOfSeries: { '@id': seriesId },
        associatedMedia: {
            '@type': 'MediaObject',
            contentUrl: mp3Url,
            encodingFormat: 'audio/mpeg',
            duration: 'PT45M',
        },
        author: { '@id': ids.person },
    }),
    buildBreadcrumbList(
        {
            url,
            items: [
                { name: 'Home', url: siteUrl },
                { name: 'Episodes', url: episodesUrl },
                { name: episodeTitle, url },
            ],
        },
        ids,
    ),
];
```

**Podcast listing page** (`/episodes/`):

```ts
const pieces = [
    // ...site-wide entities...
    buildWebPage(
        { url, name: 'Episodes', isPartOf: { '@id': ids.website }, about: { '@id': seriesId } },
        ids,
        'CollectionPage',
    ),
];
```

---

### Vacation rental / accommodation

```ts
import type { Person, VacationRental } from 'schema-dts';

const ids = makeIds({ siteUrl: 'https://myhouse.example.com' });

const pieces = [
    buildPiece<Person>({ '@type': 'Person', '@id': ids.person, name: 'Owner Name', url: siteUrl }),
    buildWebSite({ url: siteUrl, name: 'Villa Example', publisher: { '@id': ids.person } }, ids),
    buildWebPage(
        {
            url: siteUrl,
            name: 'Villa Example — Holiday Home in Tuscany',
            isPartOf: { '@id': ids.website },
        },
        ids,
    ),
    buildPiece<VacationRental>({
        '@type': 'VacationRental',
        '@id': `${siteUrl}#rental`,
        name: 'Villa Example',
        description: 'A beautiful villa...',
        url: siteUrl,
        image: [heroImageUrl],
        address: {
            '@type': 'PostalAddress',
            addressLocality: 'Lucca',
            addressRegion: 'Tuscany',
            addressCountry: 'IT',
        },
        geo: {
            '@type': 'GeoCoordinates',
            latitude: 43.84,
            longitude: 10.5,
        },
        numberOfRooms: 4,
        occupancy: {
            '@type': 'QuantitativeValue',
            maxValue: 8,
        },
        amenityFeature: [
            { '@type': 'LocationFeatureSpecification', name: 'Pool', value: true },
            { '@type': 'LocationFeatureSpecification', name: 'WiFi', value: true },
        ],
        potentialAction: {
            '@type': 'RentAction',
            target: {
                '@type': 'EntryPoint',
                urlTemplate:
                    'https://myhouse.example.com/book?checkin={checkin}&checkout={checkout}&guests={guests}',
            },
            landlord: { '@id': ids.person },
            priceSpecification: {
                '@type': 'UnitPriceSpecification',
                price: 250,
                priceCurrency: 'EUR',
                unitCode: 'DAY',
            },
        },
    }),
];
```

---

### Recipe site

```ts
import type { Recipe } from 'schema-dts';

const ids = makeIds({ siteUrl: 'https://recipes.example.com' });

const pieces = [
    // ...site-wide entities...
    buildWebPage(
        {
            url,
            name: recipeName,
            isPartOf: { '@id': ids.website },
            breadcrumb: { '@id': ids.breadcrumb(url) },
            datePublished,
        },
        ids,
    ),
    buildBreadcrumbList(
        {
            url,
            items: [
                { name: 'Home', url: siteUrl },
                { name: 'Italian', url: categoryUrl },
                { name: recipeName, url },
            ],
        },
        ids,
    ),
    buildPiece<Recipe>({
        '@type': 'Recipe',
        '@id': `${url}#recipe`,
        name: recipeName,
        author: { '@id': ids.person },
        prepTime: 'PT15M',
        cookTime: 'PT45M',
        totalTime: 'PT1H',
        recipeYield: '4 servings',
        recipeCategory: 'Main course',
        recipeCuisine: 'Italian',
        nutrition: {
            '@type': 'NutritionInformation',
            calories: '450 calories',
        },
        recipeIngredient: [
            '400g spaghetti',
            '200g guanciale',
            '4 egg yolks',
            '100g pecorino romano',
        ],
        recipeInstructions: [
            { '@type': 'HowToStep', text: 'Boil the spaghetti in salted water.' },
            { '@type': 'HowToStep', text: 'Fry the guanciale until crispy.' },
            { '@type': 'HowToStep', text: 'Mix egg yolks with pecorino.' },
            { '@type': 'HowToStep', text: 'Combine and serve immediately.' },
        ],
        description: recipeDescription,
        image: recipeImageUrl,
        datePublished: publishDate.toISOString(),
    }),
];
```

---

### Event page

```ts
import type { Event } from 'schema-dts';

buildPiece<Event>({
    '@type': 'Event',
    '@id': `${url}#event`,
    name: 'JavaScript Conference 2026',
    description: 'Annual JavaScript conference...',
    startDate: '2026-09-15T09:00:00+02:00',
    endDate: '2026-09-17T18:00:00+02:00',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    location: {
        '@type': 'Place',
        name: 'Congress Center',
        address: {
            '@type': 'PostalAddress',
            addressLocality: 'Amsterdam',
            addressCountry: 'NL',
        },
    },
    organizer: { '@id': ids.organization('organizer-slug') },
    offers: {
        '@type': 'Offer',
        price: 299,
        priceCurrency: 'EUR',
        availability: 'https://schema.org/InStock',
        url: ticketUrl,
        validFrom: '2026-01-01T00:00:00+01:00',
    },
    image: eventImageUrl,
}),
```

---

### SaaS / software product landing page

```ts
import type { Organization, SoftwareApplication } from 'schema-dts';

const pieces = [
    buildPiece<Organization>({
        '@type': 'Organization',
        '@id': ids.organization('myapp'),
        name: 'MyApp Inc',
        url: siteUrl,
        logo: logoUrl,
    }),
    buildWebSite(
        { url: siteUrl, name: 'MyApp', publisher: { '@id': ids.organization('myapp') } },
        ids,
    ),
    buildWebPage(
        {
            url: siteUrl,
            name: 'MyApp — Project Management for Teams',
            isPartOf: { '@id': ids.website },
        },
        ids,
    ),
    buildPiece<SoftwareApplication>({
        '@type': 'SoftwareApplication',
        '@id': `${siteUrl}#app`,
        name: 'MyApp',
        description: 'Project management for distributed teams.',
        url: siteUrl,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        offers: {
            '@type': 'Offer',
            price: 0,
            priceCurrency: 'USD',
            description: 'Free tier available',
        },
        aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: 4.7,
            ratingCount: 1200,
        },
        potentialAction: {
            '@type': 'BuyAction',
            target: {
                '@type': 'EntryPoint',
                url: `${siteUrl}signup/`,
            },
            price: 0,
            priceCurrency: 'USD',
            description: 'Start free trial',
        },
    }),
];
```

---

### FAQ page

Combine `WebPage` with a `FAQPage` custom piece:

```ts
import type { FAQPage } from 'schema-dts';

const pieces = [
    // ...site-wide entities...
    buildWebPage(
        { url, name: 'Frequently Asked Questions', isPartOf: { '@id': ids.website } },
        ids,
    ),
    buildPiece<FAQPage>({
        '@type': 'FAQPage',
        '@id': `${url}#faq`,
        mainEntity: [
            {
                '@type': 'Question',
                name: 'How do I install seo-graph?',
                acceptedAnswer: {
                    '@type': 'Answer',
                    text: 'Run npm install @iannuttall/seo-graph-core',
                },
            },
            {
                '@type': 'Question',
                name: 'Does it work with Next.js?',
                acceptedAnswer: {
                    '@type': 'Answer',
                    text: 'Yes. Use @iannuttall/seo-graph-core directly. The Astro integration is Astro-only.',
                },
            },
        ],
    }),
];
```

---

### Course / educational content

```ts
import type { Course } from 'schema-dts';

buildPiece<Course>({
    '@type': 'Course',
    '@id': `${url}#course`,
    name: 'Introduction to TypeScript',
    description: 'Learn TypeScript from scratch...',
    provider: { '@id': ids.organization('school-slug') },
    instructor: { '@id': ids.person },
    courseCode: 'TS-101',
    hasCourseInstance: {
        '@type': 'CourseInstance',
        courseMode: 'online',
        startDate: '2026-06-01',
        endDate: '2026-08-01',
    },
    offers: {
        '@type': 'Offer',
        price: 49,
        priceCurrency: 'USD',
    },
}),
```

---

### News / magazine site

Same as a company blog, but consider using `NewsArticle` instead of `Article`:

```ts
buildArticle({
    url,
    headline: title,
    description: excerpt,
    datePublished: publishDate,
    dateModified: modifiedDate,
    author: { '@id': authorPersonId },
    publisher: { '@id': ids.organization('newsroom') },
    isPartOf: { '@id': ids.webPage(url) },
    articleSection: section,
    image: { '@id': ids.primaryImage(url) },
}, ids, 'NewsArticle'),
```

---

## Trust and credibility signals

### publishingPrinciples

The `publishingPrinciples` property links to a document describing editorial
policies. It can be applied to `Organization`, `Person`, or `CreativeWork`
(including `Blog`). This is one of the strongest trust signals you can give
search engines and AI agents about your content's credibility.

```ts
import type { Person, Blog, Organization } from 'schema-dts';

// On a Person entity (personal blog)
buildPiece<Person>({
    '@type': 'Person',
    '@id': ids.person,
    name: 'Jane Doe',
    url: aboutUrl,
    publishingPrinciples: `${siteUrl}/editorial-policy/`,
}),

// On a Blog entity
buildPiece<Blog>({
    '@type': 'Blog',
    '@id': blogId,
    name: 'My Blog',
    url: `${siteUrl}/blog/`,
    publisher: { '@id': ids.person },
    publishingPrinciples: `${siteUrl}/editorial-policy/`,
}),

// On an Organization (news site, company blog)
buildPiece<Organization>({
    '@type': 'Organization',
    '@id': ids.organization('newsroom'),
    name: 'The Daily Example',
    publishingPrinciples: `${siteUrl}/ethics/`,
}),
```

### Specialized policy sub-properties

For news and media organizations, schema.org has more specific sub-properties
of `publishingPrinciples`:

```ts
import type { Organization } from 'schema-dts';

buildPiece<Organization>({
    '@type': 'Organization',
    '@id': ids.organization('newsroom'),
    name: 'The Daily Example',
    url: siteUrl,
    publishingPrinciples: `${siteUrl}/editorial-policy/`,
    correctionsPolicy: `${siteUrl}/corrections/`,
    verificationFactCheckingPolicy: `${siteUrl}/fact-checking/`,
    actionableFeedbackPolicy: `${siteUrl}/feedback/`,
    unnamedSourcesPolicy: `${siteUrl}/sources-policy/`,
    ownershipFundingInfo: `${siteUrl}/about/ownership/`,
    diversityStaffingReport: `${siteUrl}/diversity-report/`,
    masthead: `${siteUrl}/team/`,
}),
```

### When to use which

| Site type                          | Recommended properties                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| Personal blog                      | `publishingPrinciples` on Person or Blog                                      |
| Company blog                       | `publishingPrinciples` on Organization                                        |
| News / magazine                    | All sub-properties (corrections, fact-checking, sources, ownership, masthead) |
| Documentation site                 | `publishingPrinciples` on Organization (link to contribution guidelines)      |
| Any site with AI-generated content | `publishingPrinciples` (link to AI usage disclosure)                          |

**Practical advice:** You don't need all of these. Start with
`publishingPrinciples` on your primary entity (Person or Organization). Add
the sub-properties if you actually have those policy pages. Don't create empty
policy pages just to fill the properties.

### Copyright, licensing, and access

`WebPage` (and all `CreativeWork` types, including `Article`, `BlogPosting`,
`Blog`, and `Product`) supports copyright and licensing properties. These are
increasingly important as AI agents need to understand what they can and can't
do with your content.

**On WebPage:**

```ts
buildWebPage({
    url,
    name: title,
    isPartOf: { '@id': ids.website },
    datePublished,
    copyrightHolder: { '@id': ids.person },
    copyrightYear: 2026,
    copyrightNotice: '© 2026 Jane Doe. All rights reserved.',
    license: 'https://creativecommons.org/licenses/by/4.0/',
    isAccessibleForFree: true,
    creditText: 'Jane Doe / janedoe.com',
}, ids),
```

**On Article or BlogPosting:**

```ts
buildArticle({
    url,
    headline: title,
    // ...other article properties...
    copyrightHolder: { '@id': ids.person },
    copyrightYear: 2026,
    license: 'https://creativecommons.org/licenses/by-sa/4.0/',
}, ids, 'BlogPosting'),
```

**On WebSite (site-wide default):**

```ts
buildWebSite({
    url: siteUrl,
    name: 'My Site',
    publisher: { '@id': ids.person },
    copyrightHolder: { '@id': ids.person },
    license: 'https://creativecommons.org/licenses/by/4.0/',
}, ids),
```

### Copyright and licensing properties reference

| Property              | Type                   | Use for                                             |
| --------------------- | ---------------------- | --------------------------------------------------- |
| `copyrightHolder`     | Person or Organization | Who holds the copyright                             |
| `copyrightYear`       | Number                 | Year copyright was first asserted                   |
| `copyrightNotice`     | Text                   | Human-readable copyright text                       |
| `license`             | URL or CreativeWork    | License that applies (CC, MIT, custom)              |
| `acquireLicensePage`  | URL                    | Where to buy/request a license for reuse            |
| `creditText`          | Text                   | How to credit when reusing (e.g. "Photo: Jane Doe") |
| `isAccessibleForFree` | Boolean                | Whether the content is free to access               |
| `conditionsOfAccess`  | Text                   | Access conditions in natural language               |

### When to use what

| Scenario                            | Properties to include                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| Personal blog (all rights reserved) | `copyrightHolder`, `copyrightYear`                                               |
| Blog with Creative Commons license  | `copyrightHolder`, `copyrightYear`, `license`                                    |
| Paywalled content                   | `isAccessibleForFree: false`, `conditionsOfAccess: 'Requires paid subscription'` |
| Stock photography site              | `copyrightHolder`, `license`, `acquireLicensePage`, `creditText`                 |
| Open source docs (MIT/Apache)       | `license` pointing to the license URL                                            |
| News with free + premium tiers      | `isAccessibleForFree` per-article (true for free, false for premium)             |
| AI training opt-out signal          | `copyrightNotice` + `license` with restrictive terms                             |

**Note on AI and licensing:** While `license` and `copyrightNotice` don't
legally prevent AI training (that's what robots.txt, TDM headers, and
contracts are for), they give agents clear metadata about your content's
terms. An agent that respects licensing can check these properties before
deciding how to use your content.

---

## Choosing the right Article subtype

`buildArticle` defaults to `@type: Article`, which is correct for most content.
Pass a subtype as the third argument for more precise semantics:

| Type               | When to use                                               | Example                         |
| ------------------ | --------------------------------------------------------- | ------------------------------- |
| `Article`          | Default. General articles, tutorials, guides.             | "How to set up ESLint"          |
| `BlogPosting`      | Personal blog posts, opinion pieces, diary-style entries. | "Why I switched to Astro"       |
| `NewsArticle`      | News reporting, journalism, press releases.               | "Google announces new protocol" |
| `TechArticle`      | Technical documentation, API guides, spec write-ups.      | "WebSocket protocol deep dive"  |
| `ScholarlyArticle` | Academic papers, research publications.                   | "Effects of caching on TTFB"    |
| `Report`           | Data reports, annual reviews, research findings.          | "State of CSS 2026"             |

```ts
buildArticle(
    {
        url,
        headline: title,
        description: excerpt,
        datePublished: publishDate,
        dateModified: modifiedDate,
        author: { '@id': ids.person },
        publisher: { '@id': ids.person },
        isPartOf: { '@id': ids.webPage(url) },
        image: { '@id': ids.primaryImage(url) },
        articleSection: category,
        wordCount,
        articleBody: plainTextBody,
    },
    ids,
    'BlogPosting',
);
```

jonoalderson.com uses `BlogPosting` for all blog content. Most SEO plugins
default to `Article`. Both are valid; `BlogPosting` is more semantically
precise for personal blogs.

---

## Actions: telling agents what they can do

The `potentialAction` property on any entity tells search engines and AI agents
_what actions can be performed_ and _where to go to perform them_. This is the
mechanism that makes your schema truly agent-ready: an agent can read your
graph, find a `BuyAction` on a Product, and navigate to the checkout URL.

### The TradeAction family

All commerce-related actions inherit from `TradeAction`:

| Action           | Use for                                | Key extra property            |
| ---------------- | -------------------------------------- | ----------------------------- |
| `BuyAction`      | Direct purchase (add to cart, buy now) | `seller`                      |
| `OrderAction`    | Order for delivery                     | `deliveryMethod`              |
| `PreOrderAction` | Not yet available, reserve now         | —                             |
| `RentAction`     | Vacation rentals, equipment, cars      | `landlord`, `realEstateAgent` |
| `QuoteAction`    | Custom pricing, request a quote        | —                             |
| `SellAction`     | Marketplace listings (seller-side)     | `buyer`                       |
| `PayAction`      | Payment processing                     | —                             |
| `TipAction`      | Donations, tips, support               | —                             |

### The pattern

Every action uses `target` with an `EntryPoint` to specify the URL where the
action can be performed. The `urlTemplate` variant supports parameters:

```ts
potentialAction: {
    '@type': 'BuyAction',
    target: {
        '@type': 'EntryPoint',
        urlTemplate: 'https://shop.example.com/cart/add/{sku}',
        // or just: url: 'https://shop.example.com/cart/add/ABC123',
    },
}
```

### Buying a product

Add to the `Product` or `ProductGroup` entity:

```ts
import type { Product } from 'schema-dts';

buildPiece<Product>({
    '@type': 'Product',
    '@id': `${url}#product`,
    name: productName,
    // ...other product properties...
    potentialAction: {
        '@type': 'BuyAction',
        target: {
            '@type': 'EntryPoint',
            urlTemplate: `https://shop.example.com/cart/add/{sku}`,
        },
        seller: { '@id': ids.organization('shop') },
    },
}),
```

### Pre-ordering a product

For products not yet available:

```ts
potentialAction: {
    '@type': 'PreOrderAction',
    target: {
        '@type': 'EntryPoint',
        url: 'https://shop.example.com/pre-order/new-gadget',
    },
    description: 'Pre-order — ships March 2027',
},
```

### Ordering with delivery

When you need to specify how the product will be delivered:

```ts
potentialAction: {
    '@type': 'OrderAction',
    target: {
        '@type': 'EntryPoint',
        url: `${url}checkout/`,
    },
    deliveryMethod: 'https://schema.org/ParcelService',
},
```

`deliveryMethod` values: `ParcelService`, `OnSitePickup`, `LockerDelivery`.

### Renting (vacation rental, equipment, cars)

Add to the `VacationRental`, `Product`, or `Car` entity:

```ts
import type { VacationRental } from 'schema-dts';

buildPiece<VacationRental>({
    '@type': 'VacationRental',
    '@id': `${siteUrl}#rental`,
    name: 'Villa Example',
    // ...other rental properties...
    potentialAction: {
        '@type': 'RentAction',
        target: {
            '@type': 'EntryPoint',
            urlTemplate: 'https://myhouse.example.com/book?checkin={checkin}&checkout={checkout}',
        },
        landlord: { '@id': ids.person },
        priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: 250,
            priceCurrency: 'EUR',
            unitCode: 'DAY',
        },
    },
}),
```

**URL template variables for rentals:** `{checkin}`, `{checkout}`, `{guests}`
are conventional but not standardized. Use names that match your booking form's
query parameters.

For rentals through an agency:

```ts
potentialAction: {
    '@type': 'RentAction',
    target: {
        '@type': 'EntryPoint',
        url: 'https://bookingagency.com/listing/villa-example',
    },
    landlord: { '@id': ids.person },
    realEstateAgent: {
        '@type': 'RealEstateAgent',
        name: 'Tuscany Villas Agency',
        url: 'https://bookingagency.com/',
    },
},
```

### Requesting a quote

For services or products with custom pricing (B2B, consulting, configured
products):

```ts
potentialAction: {
    '@type': 'QuoteAction',
    target: {
        '@type': 'EntryPoint',
        url: 'https://agency.example.com/contact',
    },
    description: 'Request a project quote',
},
```

### Marketplace listings

Marketplaces often need both buy and make-offer actions:

```ts
potentialAction: [
    {
        '@type': 'BuyAction',
        target: {
            '@type': 'EntryPoint',
            url: buyNowUrl,
        },
        seller: { '@id': sellerPersonId },
        price: 499,
        priceCurrency: 'USD',
    },
    {
        '@type': 'QuoteAction',
        target: {
            '@type': 'EntryPoint',
            url: makeOfferUrl,
        },
        description: 'Make an offer',
    },
],
```

### Donations and tips

For open source projects, creators, or nonprofits:

```ts
potentialAction: {
    '@type': 'TipAction',
    target: {
        '@type': 'EntryPoint',
        url: 'https://example.com/donate',
    },
    description: 'Support this project',
    recipient: { '@id': ids.person },
},
```

### Combining actions with SearchAction

Many entities benefit from multiple actions. A WebSite typically has a
`SearchAction`; the entities within it have trade actions:

```ts
import type { Product } from 'schema-dts';

// WebSite: how to search
buildWebSite({
    url: siteUrl,
    name: 'My Shop',
    publisher: { '@id': ids.organization('shop') },
    potentialAction: {
        '@type': 'SearchAction',
        target: {
            '@type': 'EntryPoint',
            urlTemplate: `${siteUrl}search?q={search_term_string}`,
        },
        'query-input': {
            '@type': 'PropertyValueSpecification',
            valueRequired: true,
            valueName: 'search_term_string',
        },
    },
}, ids),

// Product: how to buy
buildPiece<Product>({
    '@type': 'Product',
    '@id': `${url}#product`,
    name: productName,
    potentialAction: {
        '@type': 'BuyAction',
        target: { '@type': 'EntryPoint', url: addToCartUrl },
        seller: { '@id': ids.organization('shop') },
    },
}),
```

### When to use which action

| Scenario                        | Action                                                  | Why                             |
| ------------------------------- | ------------------------------------------------------- | ------------------------------- |
| E-commerce product, buy now     | `BuyAction`                                             | Direct purchase, immediate      |
| E-commerce product, add to cart | `BuyAction`                                             | Still a buy intent              |
| Product not yet released        | `PreOrderAction`                                        | Signals future availability     |
| Physical goods with shipping    | `OrderAction` + `deliveryMethod`                        | Delivery is part of the action  |
| Vacation rental booking         | `RentAction` + `landlord`                               | Temporal use, not ownership     |
| Car rental                      | `RentAction`                                            | Temporal use                    |
| Equipment rental                | `RentAction`                                            | Temporal use                    |
| Custom/B2B pricing              | `QuoteAction`                                           | Price not fixed                 |
| Consulting services             | `QuoteAction`                                           | Scope-dependent pricing         |
| Marketplace: fixed price        | `BuyAction` + `seller`                                  | Direct from seller              |
| Marketplace: negotiable         | `BuyAction` + `QuoteAction`                             | Both options available          |
| SaaS free trial                 | `BuyAction` with `price: 0`                             | Free is still a transaction     |
| Donations / support             | `TipAction` + `recipient`                               | Voluntary, no product exchanged |
| Subscription                    | `BuyAction` + `priceSpecification` with `billingPeriod` | Recurring purchase              |

---

## Multi-type entities

An entity can have multiple `@type` values. This is useful when an entity
legitimately belongs to more than one type:

```ts
buildPiece({
    '@type': ['Organization', 'Brand'],
    '@id': ids.organization('acme'),
    name: 'Acme',
    url: 'https://acme.com/',
    logo: {
        /* ... */
    },
});
```

This is appropriate for companies that are also consumer-facing brands.

Common multi-type combinations:

- `['Organization', 'Brand']` — Company with brand identity
- `['LocalBusiness', 'Restaurant']` — Specific local business type
- `['Person', 'Patient']` — Context-specific
- `['WebPage', 'ItemPage']` — Product detail pages
- `['WebPage', 'FAQPage']` — FAQ pages (alternative to separate FAQPage entity)

**Note:** With `buildPiece`, pass the `@type` array directly:

```ts
buildPiece({
    '@type': ['Organization', 'Brand'],
    '@id': ids.organization('acme'),
    name: 'Acme',
    url: 'https://acme.com/',
});
```

---

## Rich Organization patterns

For established businesses, a richer Organization entity improves knowledge
graph representation. Here's the full pattern:

```ts
import type { Organization } from 'schema-dts';

buildPiece<Organization>({
    '@type': 'Organization',
    '@id': ids.organization('acme'),
    name: 'Acme Corp',
    url: 'https://acme.com/',
    logo: 'https://acme.com/logo.png',
    description: 'We build developer tools.',
    sameAs: [
        'https://twitter.com/acme',
        'https://linkedin.com/company/acme',
        'https://github.com/acme',
        'https://en.wikipedia.org/wiki/Acme_Corp',
    ],
    legalName: 'Acme Corp B.V.',
    foundingDate: '2015-03-01',
    founder: {
        '@type': 'Person',
        name: 'Jane Doe',
        sameAs: 'https://en.wikipedia.org/wiki/Jane_Doe',
    },
    numberOfEmployees: 45,
    slogan: 'Tools for the modern web',
    parentOrganization: {
        '@type': 'Organization',
        name: 'Parent Holdings Inc',
        url: 'https://parent.com/',
    },
    memberOf: {
        '@type': 'Organization',
        name: 'World Wide Web Consortium (W3C)',
        url: 'https://w3.org/',
    },
    address: {
        '@type': 'PostalAddress',
        streetAddress: '123 Tech Lane',
        addressLocality: 'Amsterdam',
        addressCountry: 'NL',
    },
});
```

Include as much as is factually accurate. Don't fabricate data. Properties like
`numberOfEmployees`, `foundingDate`, and `founder` are especially valuable for
knowledge graph matching.

---

## Rich Person patterns

For personal sites, a detailed Person entity establishes identity and
credibility. jonoalderson.com uses 80+ entities. Here's the extended pattern:

```ts
import type { Person } from 'schema-dts';

buildPiece<Person>({
    '@type': 'Person',
    '@id': ids.person,
    name: 'Jane Doe',
    familyName: 'Doe',
    birthDate: '1990-01-15',
    gender: 'female',
    nationality: { '@id': ids.country('US') },
    description: 'Software engineer and technical writer.',
    jobTitle: 'Lead Engineer',
    knowsLanguage: ['en', 'es', 'pt'],
    url: 'https://janedoe.com/about/',
    image: { '@id': ids.personImage },
    sameAs: [
        'https://twitter.com/janedoe',
        'https://github.com/janedoe',
        'https://linkedin.com/in/janedoe',
        'https://bsky.app/profile/janedoe.com',
        'https://mastodon.social/@janedoe',
        'https://en.wikipedia.org/wiki/Jane_Doe',
    ],
    worksFor: [
        {
            '@type': 'EmployeeRole',
            roleName: 'Lead Engineer',
            startDate: '2022-01',
            worksFor: { '@id': ids.organization('acme') },
        },
        {
            '@type': 'EmployeeRole',
            roleName: 'Advisor',
            startDate: '2024-06',
            worksFor: { '@id': ids.organization('startup') },
        },
    ],
    spouse: {
        '@type': 'Person',
        '@id': `${siteUrl}/#/schema.org/Person/john`,
        name: 'John Doe',
    },
    knowsAbout: ['TypeScript', 'Schema.org', 'Search Engine Optimization', 'Web Performance'],
    honorificPrefix: 'Dr.',
    alumniOf: {
        '@type': 'EducationalOrganization',
        name: 'MIT',
        url: 'https://mit.edu/',
    },
    award: ['Best Developer Blog 2025', 'Open Source Contributor of the Year 2024'],
});
```

**Practical advice:**

- `sameAs` is the most impactful property after name and url. It helps search
  engines connect your entity to external profiles and knowledge bases.
- `worksFor` with `EmployeeRole` is better than plain Organization references
  because it captures role and tenure.
- `knowsAbout` helps topical authority signals.
- Include a Wikipedia `sameAs` link if one exists; it strongly anchors the
  entity in the knowledge graph.

---

## The agent markdown pipeline

`renderAgentMarkdown(html, pageUrl, options)` in core turns final, owned HTML
into deterministic Markdown. It is not a general web-content extractor: it
assumes you control the markup and can follow the content selection contract
below.

Pipeline: parse with linkedom → select the content root → strip excluded
elements → normalize `href`/`src`/`srcset` to absolute URLs → convert with
Turndown 7 + the GFM plugin (tables, task lists, strikethrough, fenced code
with language labels) → validate → prepend frontmatter.

Guarantees:

- **Deterministic.** No network, model, time, randomness, or checkout-path
  input. LF endings, trailing whitespace stripped, 3+ newlines collapsed, one
  trailing newline. Same inputs → identical bytes; each page's sha256 is
  recorded in the route manifest.
- **Validated.** Exactly one H1 or the render throws. `script`, `style`,
  `svg`, or `canvas` leaking into output throws. In strict mode a violating
  page fails the whole build.
- **Frontmatter** keys are `title`, `description`, `canonical`, `language`
  in that order, JSON-quoted. `canonical` falls back to the page URL,
  `language` to `<html lang>` then `en`.
- **Token estimate** is `ceil(UTF-8 bytes / 4)`, exposed as the
  `X-Markdown-Tokens` response header and stored in the manifest.

## The content selection contract

Deliberately small — do not invent a broad annotation DSL:

- `[data-agent-content]` — opt-in content root. Falls back to `<main>`;
  if neither exists the render throws.
- `[data-agent-markdown="exclude"]` — per-element opt-out.
- Excluded by default: `script`, `style`, `template`, `noscript`, `nav`,
  `footer`, `svg`, `canvas`, `form`, `button`, `[aria-hidden="true"]`,
  `[role="tooltip"]`, `[data-agent-markdown="exclude"]`,
  `[data-code-copy]`.
- If an element carries a meaningful `aria-label` and its visible children
  are `aria-hidden`, the label text replaces the hidden spans (prevents
  glued-together decorative text).
- Callers can extend with `excludeSelectors`.

This contract is what fixes the classic failure mode of edge/managed HTML→
markdown conversion: decorative card internals, honeypot labels, and other
presentation markup leaking into what agents read.

## Astro build integration

`agentMarkdown()` from `@iannuttall/seo-graph-astro` runs at
`astro:build:done`, walks the built HTML, and emits one `.md` file per
indexable page, an `agent-routes.json` manifest, and `llms.txt`. It also
injects `<link rel="alternate" type="text/markdown">` into each HTML page.

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import { agentMarkdown } from '@iannuttall/seo-graph-astro';

export default defineConfig({
    site: 'https://example.com',
    integrations: [
        agentMarkdown({
            // excludeSelectors: ['.my-decorative-widget'],
            // strict: true,   // fail the build on contract violations
            llmsTxt: {
                title: 'Example',
                summary: 'What this site is about, one line.',
            },
        }),
    ],
});
```

Noindex pages and redirect pages are skipped; the Markdown twin of a page
shares its canonical URL.

## Collection markdown endpoints

For pages backed by a content collection, serve Markdown from the *source*
entry instead of converting built HTML — exact author intent, zero
conversion artifacts:

```ts
// src/pages/blog/[...slug].md.ts
import { getCollection } from 'astro:content';
import { createMarkdownEndpoint } from '@iannuttall/seo-graph-astro';

export const GET = createMarkdownEndpoint({
    entries: () => getCollection('blog'),
    mapper: (entry, slug) =>
        entry.id === slug
            ? {
                  frontmatter: {
                      title: entry.data.title,
                      description: entry.data.description,
                      canonical: `https://example.com/blog/${entry.id}`,
                  },
                  body: entry.body ?? '',
              }
            : null,
});
```

Options: `paramName` (default `'slug'`), `cacheControl` (default
`max-age=300`), `contentType`, `emitTokenHeader`, `extraHeaders`. The pure
renderer `renderMarkdownAlternate` and `deriveMdUrl` live in core for
non-Astro callers.

## Cloudflare content negotiation

`createCloudflareMarkdownHandler` (from
`@iannuttall/seo-graph-astro/cloudflare`) serves the prebuilt `.md` bytes at
the *canonical HTML URL* when a client sends `Accept: text/markdown`:

```ts
// src/worker.ts (Cloudflare Worker with static assets)
import { createCloudflareMarkdownHandler } from '@iannuttall/seo-graph-astro/cloudflare';

const markdown = createCloudflareMarkdownHandler({
    site: 'https://example.com',
    contentSignal: 'search=yes, ai-input=yes, ai-train=yes',
});
```

It does full RFC 9110 Accept parsing (q-values, specificity; `q=0` refuses
markdown, `*/*` gets HTML), adds `Vary: Accept`, canonical/alternate `Link`
headers, `X-Markdown-Tokens`, your `Content-Signal`, and preserves noindex
as `X-Robots-Tag`. Options: `base`, `canonicalHosts`, `noindexPaths`,
`ignoredMarkdownPrefixes`, `responseHeaders`.

## Schema endpoints and the schema map

Serve a whole collection as one deduplicated JSON-LD `@graph`, and an XML
map of those endpoints for agent discovery:

```ts
// src/pages/schema/blog.json.ts
import { getCollection } from 'astro:content';
import { createSchemaEndpoint } from '@iannuttall/seo-graph-astro';
import { buildArticle } from '@iannuttall/seo-graph-core';

export const GET = createSchemaEndpoint({
    entries: () => getCollection('blog'),
    mapper: (entry) => [
        buildArticle({
            '@type': 'BlogPosting',
            headline: entry.data.title,
            url: `https://example.com/blog/${entry.id}`,
            datePublished: entry.data.pubDate,
        }),
    ],
});
```

`createSchemaMap` emits the sitemap-style XML listing; `createApiCatalog`
serves an [RFC 9727](https://www.rfc-editor.org/rfc/rfc9727) catalog at
`/.well-known/api-catalog` tying the endpoints together. The `aggregate`
engine (in core) walks entries, runs your mapper, and dedupes by `@id`.

## llms.txt and the route manifest

`agentMarkdown()` writes both:

- **`llms.txt`** — curated sections via `llmsTxt.sections`, or an
  auto-generated page list from the build output. Deterministic ordering.
- **`agent-routes.json`** — every HTML route and its Markdown twin with
  per-page sha256 and token counts, so parity between representations is
  provable rather than assumed.

## IndexNow

- `createIndexNowKeyRoute({ key })` serves the key-verification file.
- `indexNowOnBranch(branch, options)` gates submission so preview branches
  never submit (`process.env.CF_PAGES_BRANCH`, `VERCEL_GIT_COMMIT_REF`…).
- Core ships `submitToIndexNow`, manifest hashing (`buildUrlManifest`,
  `diffManifests`, `changedUrls`) for incremental submits — only URLs whose
  content hash changed since the last deploy get submitted, with the
  previous manifest fetched from the live site so CI stays stateless.
- `gitLastmod(filePath)` derives trustworthy `dateModified`/`<lastmod>`
  values from git history (skipping bulk commits you name), instead of
  hand-maintained frontmatter dates.

## Common mistakes

1. **Forgetting to link entities.** Every `Article` needs `isPartOf` pointing to
   its `WebPage`. Every `WebPage` needs `isPartOf` pointing to the `WebSite`.
   Missing links produce valid JSON-LD but an unconnected graph that search
   engines can't walk.

2. **Duplicating site-wide entities.** `WebSite` and `Person` should appear once
   in the graph. `assembleGraph` deduplicates by `@id` (first wins), so it's
   safe to include them in every page's piece array.

3. **Using wrong WebPage subtype.** Archive/listing pages should be
   `CollectionPage`, not `WebPage`. About pages should be `ProfilePage`.

4. **Relative URLs.** All URLs in the graph must be absolute
   (`https://example.com/page/`, not `/page/`).

5. **Missing trailing slashes.** Be consistent. If your site uses trailing
   slashes, use them everywhere in the graph. Mismatched URLs create
   duplicate entities.

6. **Inlining entities instead of referencing.** Don't put a full Person object
   inside an Article's `author` field. Use `{ '@id': ids.person }` and let the
   graph resolver connect them.

7. **Not including the graph in the page head.** Building the graph is step one.
   You still need to render it as `<script type="application/ld+json">` in
   your page. Pass the assembled graph to the JSON-LD `<script>` in your layout. In
   non-Astro setups, inject it manually.

8. **Omitting `@context`.** Always use `assembleGraph()` to wrap your pieces.
   It adds `"@context": "https://schema.org"` automatically. Don't build the
   envelope by hand.

---

## Validating your output

After building a graph, validate it:

1. **Google Rich Results Test:** https://search.google.com/test/rich-results
2. **Schema.org Validator:** https://validator.schema.org/
3. **Check `@id` resolution:** Every `{ "@id": "..." }` reference in the graph
   should have a matching entity with that `@id`. If not, the reference is
   broken.

---


## Repository structure

```txt
seo-graph/
├── packages/
│   ├── core/                # @iannuttall/seo-graph-core
│   │   └── src/
│   │       ├── render.ts            # built-HTML → markdown renderer
│   │       ├── markdown-alternate.ts# collection-source renderer
│   │       ├── routes.ts            # HTML ↔ .md route mapping
│   │       ├── manifest.ts          # agent-routes.json + hashing
│   │       ├── llms.ts              # llms.txt rendering
│   │       ├── html.ts              # alternate-link injection, noindex/redirect detection
│   │       ├── aggregator.ts        # entry → graph aggregation + dedupe
│   │       ├── git-lastmod.ts       # dateModified from git history
│   │       ├── indexnow-manifest.ts # incremental IndexNow hashing
│   │       └── schema/              # schema.org piece builders (see NOTICE)
│   └── astro/               # @iannuttall/seo-graph-astro
│       └── src/
│           ├── integration.ts       # agentMarkdown() build hook
│           ├── markdown-routes.ts   # createMarkdownEndpoint
│           ├── schema-endpoints.ts  # createSchemaEndpoint / createSchemaMap
│           ├── cloudflare.ts        # Accept-negotiation Worker handler
│           ├── indexnow.ts          # key route + re-exports
│           ├── indexnow-helpers.ts  # indexNowOnBranch, htmlFileToUrl
│           ├── content-helpers.ts   # seoSchema / imageSchema (zod)
│           └── api-catalog.ts       # RFC 9727 /.well-known/api-catalog
├── AGENTS.md                # this file (CLAUDE.md symlinks here)
├── NOTICE                   # MIT attribution for derived portions
└── LICENSE                  # MIT
```
