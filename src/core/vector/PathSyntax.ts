const parameterCounts: Readonly<Record<string, number>> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
}
/** Validate path grammar and coordinate budgets before giving untrusted data to geometry libraries. */
export function validatePathSyntax(d: string): void {
  if (d.length > 1_000_000)
    throw new Error('Vector path exceeds the source budget')
  const tokens =
    d.match(/[a-df-zA-DF-Z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []
  if (
    d.replace(
      /[a-df-zA-DF-Z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[\s,]+/g,
      '',
    ) ||
    tokens.length > 70000
  )
    throw new Error('Invalid vector path tokens')
  if (!tokens.length) return
  if (tokens[0]?.toUpperCase() !== 'M')
    throw new Error('Vector paths must begin with moveto')
  let i = 0,
    command = ''
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i]!)) {
      command = tokens[i++]!.toUpperCase()
      if (command === 'Z') {
        command = ''
        continue
      }
    }
    const count = parameterCounts[command]
    if (!count || i + count > tokens.length)
      throw new Error('Incomplete vector path command')
    for (let j = 0; j < count; j++) {
      const raw = tokens[i + j]!,
        value = Number(raw)
      if (!Number.isFinite(value) || Math.abs(value) > 1_000_000)
        throw new Error('Invalid or oversized vector path coordinate')
      if (command === 'A' && (j === 3 || j === 4) && raw !== '0' && raw !== '1')
        throw new Error('Invalid SVG arc flag')
    }
    i += count
    if (command === 'M') command = 'L'
  }
}
