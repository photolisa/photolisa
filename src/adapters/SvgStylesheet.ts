/** Deliberately small CSS subset for editable SVG paint. Never attach untrusted CSS to the page. */
const properties = new Set(['fill', 'stroke', 'stroke-width', 'fill-rule', 'fill-opacity', 'stroke-opacity', 'opacity', 'display', 'visibility', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'vector-effect', 'stop-color', 'stop-opacity'])
const selectorPattern = /^(?:(svg|g|path|rect|circle|ellipse|polygon|line))?\.([A-Za-z_][\w-]*)$/
const unsafeCss = /@|\\|url\s*\(|expression\s*\(|javascript:|data:|https?:|file:/i

interface Selector { tag: string | null; className: string; specificity: number }
interface Rule { selectors: Selector[]; declarations: Map<string, string> }

export class SvgStylesheet {
  private constructor(private readonly rules: readonly Rule[]) {}

  static parse(root: Element, warnings: string[]): SvgStylesheet {
    const rules: Rule[] = []
    for (const style of Array.from(root.getElementsByTagName('style'))) {
      const type = style.getAttribute('type')
      if (type && type.toLowerCase() !== 'text/css') {
        warnings.push(`SVG stylesheet type “${type}” was skipped.`)
        continue
      }
      const media = style.getAttribute('media')
      if (media && media.toLowerCase() !== 'all') {
        warnings.push(`SVG stylesheet media “${media}” was skipped.`)
        continue
      }
      const raw = style.textContent ?? ''
      if (raw.length > 256_000) throw new Error('SVG stylesheet exceeds the 256 KiB limit')
      const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')
      if (css.includes('/*') || css.includes('*/')) throw new Error('Invalid SVG stylesheet comment')
      if (unsafeCss.test(css.replace(/url\(#[A-Za-z_][\w.-]*\)/g, ''))) throw new Error('Unsafe or unsupported SVG stylesheet content')
      const pattern = /([^{}]+)\{([^{}]*)\}/g
      let position = 0
      for (const match of css.matchAll(pattern)) {
        if (css.slice(position, match.index).trim()) throw new Error('Unsupported SVG stylesheet syntax')
        position = match.index! + match[0].length
        if (rules.length >= 512) throw new Error('SVG stylesheet has too many rules')
        const selectors = match[1]!.split(',').map((rawSelector) => {
          const text = rawSelector.trim()
          const parsed = selectorPattern.exec(text)
          if (!parsed) { warnings.push(`SVG selector “${text}” was skipped; only simple class selectors are supported.`); return null }
          return { tag: parsed[1] ?? null, className: parsed[2]!, specificity: parsed[1] ? 11 : 10 }
        }).filter((selector): selector is Selector => selector !== null)
        const declarations = parseSvgDeclarations(match[2]!, warnings, 'stylesheet')
        if (selectors.length) rules.push({ selectors, declarations })
      }
      if (css.slice(position).trim()) throw new Error('Unsupported SVG stylesheet syntax')
    }
    return new SvgStylesheet(rules)
  }

  declarationsFor(element: Element): Map<string, string> {
    const names = new Set((element.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean))
    const result = new Map<string, { value: string; specificity: number }>()
    for (const rule of this.rules) {
      const specificity = Math.max(0, ...rule.selectors.filter((selector) => names.has(selector.className) && (!selector.tag || selector.tag === element.localName)).map((selector) => selector.specificity))
      if (!specificity) continue
      for (const [key, value] of rule.declarations) {
        const previous = result.get(key)
        if (!previous || specificity >= previous.specificity) result.set(key, { value, specificity })
      }
    }
    return new Map([...result].map(([key, item]) => [key, item.value]))
  }
}

export function parseSvgDeclarations(raw: string, warnings: string[], source: 'stylesheet' | 'inline'): Map<string, string> {
  const result = new Map<string, string>()
  if (unsafeCss.test(raw.replace(/url\(#[A-Za-z_][\w.-]*\)/g, ''))) throw new Error('Unsafe or unsupported SVG style content')
  for (const part of raw.split(';')) {
    if (!part.trim()) continue
    const split = part.indexOf(':')
    if (split < 1) throw new Error('Invalid SVG style declaration')
    const key = part.slice(0, split).trim().toLowerCase()
    const value = part.slice(split + 1).trim()
    if (properties.has(key)) result.set(key, value)
    else warnings.push(`Unsupported SVG ${source} style “${key}” was skipped.`)
  }
  return result
}
