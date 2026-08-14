export interface AcceptMediaRange {
  order: number
  quality: number
  subtype: string
  type: string
}

function splitHeader(value: string, separator: string): string[] {
  const parts: string[] = []
  let current = ''
  let quoted = false

  for (const character of value) {
    if (character === '"') quoted = !quoted
    if (character === separator && !quoted) {
      parts.push(current)
      current = ''
    } else {
      current += character
    }
  }
  parts.push(current)
  return parts
}

function parseQuality(value: string | undefined): number {
  if (!value) return 1
  const normalized = value.trim().replace(/^"|"$/gu, '')
  if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/u.test(normalized)) return 0
  return Number(normalized)
}

export function parseAccept(value: string | null): AcceptMediaRange[] {
  if (!value) return []

  return splitHeader(value, ',')
    .map((part, order): AcceptMediaRange | undefined => {
      const [mediaRange, ...parameters] = splitHeader(part, ';')
      const mediaParts = (mediaRange ?? '').trim().toLowerCase().split('/')
      if (mediaParts.length !== 2) return undefined
      const [type, subtype] = mediaParts
      if (!type || !subtype) return undefined
      const qualityParameters = parameters.filter((parameter) =>
        /^\s*q\s*=/iu.test(parameter),
      )
      const quality =
        qualityParameters.length > 1
          ? 0
          : parseQuality(qualityParameters[0]?.split('=', 2)[1])
      return { order, quality, subtype, type }
    })
    .filter((range): range is AcceptMediaRange => Boolean(range))
}

function mediaRangeSpecificity(
  range: AcceptMediaRange,
  type: string,
  subtype: string,
): number {
  if (range.type === type && range.subtype === subtype) return 2
  if (range.type === type && range.subtype === '*') return 1
  if (range.type === '*' && range.subtype === '*') return 0
  return -1
}

function qualityFor(
  ranges: readonly AcceptMediaRange[],
  type: string,
  subtype: string,
): number {
  const candidates = ranges
    .map((range) => ({
      ...range,
      specificity: mediaRangeSpecificity(range, type, subtype),
    }))
    .filter((range) => range.specificity >= 0)
    .sort(
      (left, right) =>
        right.specificity - left.specificity ||
        right.quality - left.quality ||
        left.order - right.order,
    )
  return candidates[0]?.quality ?? 0
}

/**
 * Return true only when an explicit `text/markdown` range is acceptable and
 * has a higher effective quality than HTML. Ties and wildcards keep HTML.
 */
export function acceptsMarkdown(value: string | null): boolean {
  const ranges = parseAccept(value)
  const explicitMarkdown = ranges.some(
    (range) =>
      range.type === 'text' &&
      range.subtype === 'markdown' &&
      range.quality > 0,
  )
  if (!explicitMarkdown) return false

  const markdownQuality = qualityFor(ranges, 'text', 'markdown')
  const htmlQuality = qualityFor(ranges, 'text', 'html')
  return markdownQuality > htmlQuality
}
