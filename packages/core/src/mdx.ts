const importOrExport =
  /^\s{0,3}(?:import\s+(?:[\w*{]|["'])|export\s+(?:default\b|const\b|let\b|var\b|function\b|class\b|\{|\*))/u

function stripModuleStatements(value: string): string {
  const lines = value.split('\n')
  const kept: string[] = []
  let skipping = false
  let depth = 0

  for (const line of lines) {
    if (!skipping && !importOrExport.test(line)) {
      kept.push(line)
      continue
    }

    if (!skipping) skipping = true
    for (const character of line) {
      if ('{[('.includes(character)) depth += 1
      else if ('}])'.includes(character)) depth -= 1
    }
    const trimmed = line.trimEnd()
    const complete =
      trimmed.endsWith(';') ||
      (depth <= 0 &&
        (/\bfrom\s+["'][^"']+["']$/u.test(trimmed) ||
          /^\s{0,3}import\s+["'][^"']+["']$/u.test(trimmed) ||
          !/[{[(,]$/u.test(trimmed)))
    if (complete) {
      skipping = false
      depth = 0
    }
  }

  return kept.join('\n')
}

function stripJsxComponents(value: string): string {
  const inlineCode: string[] = []
  let protectedValue = value.replace(/(`+)([^\n]*?)\1/gu, (match) => {
    const marker = `SEO_GRAPH_INLINE_CODE_${inlineCode.length}_TOKEN`
    inlineCode.push(match)
    return marker
  })
  protectedValue = protectedValue.replace(
    /<([A-Z][\w.]*)\b[^>]*\/>/gu,
    '',
  )
  const paired = /<([A-Z][\w.]*)\b[^>]*>([\s\S]*?)<\/\1>/gu
  for (;;) {
    const next = protectedValue.replace(paired, '$2')
    if (next === protectedValue) break
    protectedValue = next
  }
  return protectedValue.replace(
    /SEO_GRAPH_INLINE_CODE_(\d+)_TOKEN/gu,
    (_match, index: string) => inlineCode[Number(index)] ?? '',
  )
}

/**
 * Remove MDX module statements and uppercase JSX components while preserving
 * fenced and inline code. Lowercase HTML stays unchanged.
 */
export function cleanMdx(body: string): string {
  if (!body) return ''

  const lines = body.replaceAll('\r\n', '\n').split('\n')
  const output: string[] = []
  let prose: string[] = []
  let fence: { character: '`' | '~'; length: number } | undefined

  const flushProse = (): void => {
    if (prose.length === 0) return
    output.push(stripJsxComponents(stripModuleStatements(prose.join('\n'))))
    prose = []
  }

  for (const line of lines) {
    const match = line.match(/^\s{0,3}(`{3,}|~{3,})/u)
    if (fence) {
      output.push(line)
      if (
        match &&
        match[1]?.[0] === fence.character &&
        match[1].length >= fence.length
      ) {
        fence = undefined
      }
      continue
    }
    if (match) {
      flushProse()
      const marker = match[1]!
      fence = {
        character: marker[0] as '`' | '~',
        length: marker.length,
      }
      output.push(line)
      continue
    }
    prose.push(line)
  }
  flushProse()

  const cleaned = output.join('\n').replace(/\n{3,}/gu, '\n\n').trim()
  return cleaned ? `${cleaned}\n` : ''
}
