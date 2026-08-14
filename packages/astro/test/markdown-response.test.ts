import { describe, expect, it } from 'vitest'
import { markdownResponse, md } from '../src/markdown-response.js'

describe('Markdown response helpers', () => {
  it('builds a normalized response with discovery headers', async () => {
    const response = markdownResponse('# Guide', {
      canonical: 'https://example.com/guide',
      describedBy: 'https://example.com/llms.txt',
      noindex: true,
    })
    expect(response.headers.get('Content-Type')).toBe(
      'text/markdown; charset=utf-8',
    )
    expect(response.headers.get('X-Markdown-Tokens')).toMatch(/^\d+$/u)
    expect(response.headers.get('Link')).toContain('rel="canonical"')
    expect(response.headers.get('Link')).toContain('rel="describedby"')
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, follow')
    expect(await response.text()).toBe('# Guide\n')
  })

  it('supports readable templates, arrays and inline helpers', async () => {
    const response = md`
      # Guide

      ${['- First', '- Second']}

      ${md.link('Read [more]', '/more')}
    `
    expect(await response.text()).toBe(
      '# Guide\n\n- First\n- Second\n\n[Read \\[more\\]](/more)\n',
    )
    expect(md.heading(2, 'More')).toBe('## More')
    expect(() => md.heading(7, 'No')).toThrow()
  })
})
