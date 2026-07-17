import { describe, expect, it } from 'vitest';
import { agentMarkdownMiddleware } from '../src/middleware.js';

const PAGE_HTML = `<!doctype html><html lang="en"><head>
  <title>Live stats</title>
  <meta name="description" content="Live stats description">
  <link rel="canonical" href="https://example.com/stats">
</head><body><main><h1>Live stats</h1><p>Current count: 42.</p>
<section data-agent-markdown="exclude"><p>Decorative widget</p></section>
</main></body></html>`;

type MinimalContext = {
    url: URL;
    site?: URL;
    rewrite: (path: string | URL | Request) => Promise<Response>;
};

function context(
    pathname: string,
    rewrite?: MinimalContext['rewrite'],
): MinimalContext {
    return {
        url: new URL(`https://example.com${pathname}`),
        site: new URL('https://example.com'),
        rewrite:
            rewrite ??
            (async () =>
                new Response(PAGE_HTML, {
                    headers: { 'Content-Type': 'text/html; charset=utf-8' },
                })),
    };
}

const notFound = async () => new Response('Not Found', { status: 404 });
const run = (
    ctx: MinimalContext,
    next: () => Promise<Response>,
): Promise<Response> =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    agentMarkdownMiddleware()(ctx as any, next as any) as Promise<Response>;

describe('agentMarkdownMiddleware', () => {
    it('renders a live markdown twin when no route answers the .md path', async () => {
        const response = await run(context('/stats.md'), notFound);
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe(
            'text/markdown; charset=utf-8',
        );
        expect(response.headers.get('X-Markdown-Tokens')).toMatch(/^\d+$/);
        expect(response.headers.get('Link')).toContain(
            '<https://example.com/stats>; rel="canonical"',
        );
        expect(response.headers.get('Vary')).toBe('Accept');
        expect(response.headers.get('Cache-Control')).toBe('max-age=300');
        const body = await response.text();
        expect(body).toContain('# Live stats');
        expect(body).toContain('Current count: 42.');
        expect(body).not.toContain('Decorative widget');
        expect(body).toContain('canonical: "https://example.com/stats"');
    });

    it('maps /index.md to the root route', async () => {
        let rewritten = '';
        const response = await run(
            context('/index.md', async (path) => {
                rewritten = String(path);
                return new Response(PAGE_HTML, {
                    headers: { 'Content-Type': 'text/html' },
                });
            }),
            notFound,
        );
        expect(response.status).toBe(200);
        expect(rewritten).toBe('/');
    });

    it('never shadows an app route that answers the .md path itself', async () => {
        const own = new Response('app markdown', {
            headers: { 'Content-Type': 'text/markdown' },
        });
        const response = await run(context('/stats.md'), async () => own);
        expect(response).toBe(own);
    });

    it('mirrors the HTML Cache-Control onto the markdown twin', async () => {
        const response = await run(
            context(
                '/stats.md',
                async () =>
                    new Response(PAGE_HTML, {
                        headers: {
                            'Content-Type': 'text/html',
                            'Cache-Control': 'public, s-maxage=3600',
                        },
                    }),
            ),
            notFound,
        );
        expect(response.headers.get('Cache-Control')).toBe(
            'public, s-maxage=3600',
        );
    });

    it('degrades to the 404 when the page violates the content contract', async () => {
        const response = await run(
            context(
                '/stats.md',
                async () =>
                    new Response('<html><body><p>no main</p></body></html>', {
                        headers: { 'Content-Type': 'text/html' },
                    }),
            ),
            notFound,
        );
        expect(response.status).toBe(404);
    });

    it('degrades to the 404 when the HTML route does not resolve', async () => {
        const response = await run(
            context('/stats.md', async () => new Response('nope', { status: 404 })),
            notFound,
        );
        expect(response.status).toBe(404);
    });

    it('decorates server-rendered HTML with an alternate link and Vary', async () => {
        const response = await run(context('/stats'), async () =>
            new Response(PAGE_HTML, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
            }),
        );
        expect(response.headers.get('Link')).toContain(
            '<https://example.com/stats.md>; rel="alternate"; type="text/markdown"',
        );
        expect(response.headers.get('Vary')).toBe('Accept');
        expect(await response.text()).toBe(PAGE_HTML);
    });

    it('leaves non-HTML responses untouched', async () => {
        const json = new Response('{}', {
            headers: { 'Content-Type': 'application/json' },
        });
        const response = await run(context('/api/stats'), async () => json);
        expect(response).toBe(json);
    });
});
