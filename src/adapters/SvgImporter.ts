import { EditorDocument, createEntityId } from '../core/model/EditorDocument'
import { createLayerBase, type AffineMatrix, type Layer, type VectorGeometry, type VectorStyle, type VectorGradient } from '../core/model/types'
import { validateFileSize } from './FileSafety'
import { parseSvgDeclarations, SvgStylesheet } from './SvgStylesheet'

const supported = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'defs', 'linearGradient', 'radialGradient', 'stop', 'title', 'desc', 'style'])
const rejected = new Set(['script', 'foreignObject', 'iframe', 'object', 'embed', 'image', 'use', 'filter', 'mask', 'clipPath', 'pattern', 'text'])
const activeContent = new Set(['script', 'foreignObject', 'iframe', 'object', 'embed'])
const allowedAttributes = new Set(['xmlns', 'version', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'id', 'class', 'transform', 'opacity', 'fill', 'stroke', 'stroke-width', 'fill-rule', 'fill-opacity', 'stroke-opacity', 'display', 'visibility', 'style', 'd', 'x', 'y', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'points', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'vector-effect', 'gradientUnits', 'gradientTransform', 'clip-path', 'data-photolisa-stroke-alignment', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'fx', 'fy', 'offset', 'stop-color', 'stop-opacity'])

export interface SvgImportResult { document: EditorDocument; warnings: string[] }

export class SvgImporter {
  async import(file: File): Promise<SvgImportResult> {
    validateFileSize(file, 'SVG')
    if (file.size > 8 * 1024 * 1024) throw new Error('SVG exceeds the 8 MiB source limit')
    return this.parse(await file.text(), file.name.replace(/\.svg$/i, '') || 'Imported SVG')
  }

  parse(input: string, name = 'Imported SVG'): SvgImportResult {
    if (input.length > 8 * 1024 * 1024) throw new Error('SVG exceeds the 8 MiB source limit')
    if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(input)) throw new Error('SVG DTDs and entities are not allowed')
    const xml = new DOMParser().parseFromString(input, 'image/svg+xml')
    if (xml.querySelector('parsererror')) throw new Error('SVG XML is invalid')
    const root = xml.documentElement
    if (root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') throw new Error('Not an SVG document')
    for (const element of Array.from(xml.getElementsByTagName('*'))) {
      if (activeContent.has(element.localName)) throw new Error(`Unsafe SVG element: <${element.localName}>`)
      for (const attr of Array.from(element.attributes)) {
        if (attr.name === 'xmlns' && attr.value === 'http://www.w3.org/2000/svg') continue
        const safeGradient = (attr.localName === 'fill' || attr.localName === 'clip-path') && /^url\(#[A-Za-z_][\w.-]*\)$/.test(attr.value)
        const safeStyle = attr.localName === 'style' && !/(?:url\s*\(|javascript:|data:|https?:|file:|@import)/i.test(attr.value.replace(/url\(#[A-Za-z_][\w.-]*\)/g, ''))
        if (/^on/i.test(attr.localName) || (!safeGradient && !safeStyle && /(?:url\s*\(|javascript:|data:|https?:|file:|@import)/i.test(attr.value)) || attr.localName === 'href' || attr.namespaceURI === 'http://www.w3.org/1999/xlink') throw new Error(`Unsafe SVG attribute: ${attr.name}`)
      }
    }
    const warnings: string[] = []
    const gradients = readGradients(root)
    const stylesheet = SvgStylesheet.parse(root, warnings)
    let count = 0
    const visit = (element: Element, inherited: VectorStyle, depth: number): Layer[] => {
      if (++count > 10_000 || depth > 64) throw new Error('SVG element budget exceeded')
      const tag = element.localName
      if (tag === 'svg' && depth > 0) { warnings.push('Nested <svg> viewport was skipped.'); return [] }
      if (element.namespaceURI !== 'http://www.w3.org/2000/svg') throw new Error('Foreign SVG namespaces are not supported')
      for (const attr of Array.from(element.attributes)) {
        const key = attr.localName
        const value = attr.value
        if (attr.name === 'xmlns' && value === 'http://www.w3.org/2000/svg') continue
        if (tag === 'style' && (key === 'type' || key === 'media')) continue
        if (!allowedAttributes.has(key) && !key.startsWith('xmlns')) warnings.push(`Unsupported attribute “${attr.name}” on <${tag}> was skipped.`)
      }
      if (activeContent.has(tag)) throw new Error(`Unsafe SVG element: <${tag}>`)
      if (rejected.has(tag)) { warnings.push(`<${tag}> was skipped; this feature is not editable in Photolisa.`); return [] }
      if (!supported.has(tag)) { warnings.push(`<${tag}> was skipped; this element is unsupported.`); return [] }
      if (tag === 'defs' || tag === 'linearGradient' || tag === 'radialGradient' || tag === 'stop') return []
      if (tag === 'title' || tag === 'desc' || tag === 'style') return []
      const declarations = readDeclarations(element, stylesheet, warnings)
      const style = readStyle(element, declarations, inherited, gradients)
      const matrix = parseTransform(element.getAttribute('transform'))
      const opacity = numericValue(declarations.get('opacity') ?? element.getAttribute('opacity'), 'opacity', 1)
      if (opacity < 0 || opacity > 1) throw new Error('Invalid SVG opacity')
      const base = { ...createLayerBase(createEntityId(), tag === 'g' || tag === 'svg' ? 'group' : 'vector', element.getAttribute('id') || tag), opacity, visible: (declarations.get('display') ?? element.getAttribute('display')) !== 'none' && (declarations.get('visibility') ?? element.getAttribute('visibility')) !== 'hidden', ...(matrix ? { svgMatrix: matrix } : {}) }
      if (tag === 'svg' || tag === 'g') {
        const children = Array.from(element.children).flatMap((child) => visit(child, style, depth + 1))
        if (tag === 'svg' && !matrix && opacity === 1 && base.visible) return children
        return [{ ...base, kind: 'group', children }]
      }
      const alignment = element.getAttribute('data-photolisa-stroke-alignment')
      if (element.hasAttribute('clip-path')) {
        if (tag !== 'path' || !alignment || !['inside', 'outside'].includes(alignment)) { warnings.push('An unsupported clipped SVG element was skipped.'); return [] }
        style.strokeAlignment = alignment as 'inside' | 'outside'; style.strokeWidth /= 2
      }
      const geometry = readGeometry(element)
      return [{ ...base, kind: 'vector', geometry, style }]
    }
    const viewBox = parseViewBox(root.getAttribute('viewBox'))
    const width = dimension(root.getAttribute('width'), viewBox?.width)
    const height = dimension(root.getAttribute('height'), viewBox?.height)
    if (!width || !height) throw new Error('SVG requires pixel width and height or a viewBox')
    if (width > 16_384 || height > 16_384 || width * height > 67_108_864) throw new Error('SVG dimensions exceed the safe document budget')
    let layers = visit(root, { fill: '#000000', stroke: null, strokeWidth: 1, fillRule: 'nonzero', fillOpacity: 1, strokeOpacity: 1 }, 0)
    if (viewBox && (viewBox.x !== 0 || viewBox.y !== 0 || viewBox.width !== width || viewBox.height !== height)) {
      const none = root.getAttribute('preserveAspectRatio') === 'none'
      const ratio = Math.min(width / viewBox.width, height / viewBox.height)
      const scaleX = none ? width / viewBox.width : ratio
      const scaleY = none ? height / viewBox.height : ratio
      const offsetX = (width - viewBox.width * scaleX) / 2 - viewBox.x * scaleX
      const offsetY = (height - viewBox.height * scaleY) / 2 - viewBox.y * scaleY
      const group = { ...createLayerBase(createEntityId(), 'group', 'SVG viewBox'), kind: 'group' as const, svgMatrix: [scaleX, 0, 0, scaleY, offsetX, offsetY] as AffineMatrix, children: layers }
      layers = [group]
      if (root.getAttribute('preserveAspectRatio') && !['none', 'xMidYMid meet'].includes(root.getAttribute('preserveAspectRatio')!)) warnings.push('Non-default preserveAspectRatio alignment was approximated using centered fit.')
    }
    const now = new Date().toISOString()
    const document = EditorDocument.deserialize({ version: 3, id: createEntityId(), name, dimensions: { width, height, resolution: 72 }, background: 'transparent', layers, selectedLayerIds: layers.at(-1) ? [layers.at(-1)!.id] : [], activeLayerId: layers.at(-1)?.id ?? null, revision: 0, metadata: { createdAt: now, modifiedAt: now, sourceFormat: 'svg', ...(viewBox ? { svgViewBox: viewBox } : {}), compatibilityWarnings: warnings } })
    return { document, warnings }
  }
}

function numeric(element: Element, key: string, fallback = 0): number {
  return numericValue(element.getAttribute(key), key, fallback)
}

function numericValue(raw: string | null, key: string, fallback = 0): number {
  if (raw === null) return fallback
  const number = Number(raw)
  if (!Number.isFinite(number) || Math.abs(number) > 1_000_000) throw new Error(`Invalid SVG ${key}`)
  return number
}

function dimension(raw: string | null, fallback?: number): number | null {
  if (raw === null) return fallback ?? null
  if (!/^\d+(?:\.\d+)?(?:px)?$/.test(raw.trim())) throw new Error('Only pixel SVG dimensions are supported')
  const value = Number.parseFloat(raw)
  if (!Number.isInteger(value) || value < 1) throw new Error('SVG dimensions must be positive integer pixels')
  return value
}

function parseViewBox(raw: string | null): { x: number; y: number; width: number; height: number } | null {
  if (!raw) return null
  const values = raw.trim().split(/[\s,]+/).map(Number)
  if (values.length !== 4 || values.some((v) => !Number.isFinite(v)) || !values[2] || !values[3] || values[2] < 0 || values[3] < 0) throw new Error('Invalid SVG viewBox')
  return { x: values[0]!, y: values[1]!, width: values[2]!, height: values[3]! }
}

function readDeclarations(element: Element, stylesheet: SvgStylesheet, warnings: string[]): Map<string, string> {
  const result = stylesheet.declarationsFor(element)
  const raw = element.getAttribute('style')
  if (!raw) return result
  for (const [key, value] of parseSvgDeclarations(raw, warnings, 'inline')) result.set(key, value)
  return result
}

function readStyle(element: Element, declarations: ReadonlyMap<string, string>, parent: VectorStyle, gradients: Map<string, VectorGradient>): VectorStyle {
  const value = (key: string): string | null => declarations.get(key) ?? element.getAttribute(key)
  const color = (key: 'fill' | 'stroke', fallback: string | null): string | null => {
    const raw = value(key)
    if (raw === null || raw === 'inherit') return fallback
    if (raw === 'none') return null
    if (!/^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|[a-z]+|rgba?\([\d.,%\s]+\)|hsla?\([\d.,%\s]+\))$/i.test(raw)) throw new Error(`Unsupported or unsafe SVG ${key}`)
    return raw
  }
  const rawFill = value('fill')
  const gradientId = rawFill?.match(/^url\(#([A-Za-z_][\w.-]*)\)$/)?.[1]
  const fillGradient = gradientId ? gradients.get(gradientId) : rawFill === null || rawFill === 'inherit' ? parent.fillGradient : undefined
  if (gradientId && !fillGradient) throw new Error('Unknown SVG gradient')
  const cap = value('stroke-linecap') ?? parent.strokeCap
  const join = value('stroke-linejoin') ?? parent.strokeJoin
  const dash = value('stroke-dasharray')
  const fillRule = value('fill-rule')
  if (fillRule && fillRule !== 'nonzero' && fillRule !== 'evenodd') throw new Error('Unsupported SVG fill-rule')
  const fillOpacity = numericValue(value('fill-opacity'), 'fill-opacity', parent.fillOpacity ?? 1)
  const strokeOpacity = numericValue(value('stroke-opacity'), 'stroke-opacity', parent.strokeOpacity ?? 1)
  if (fillOpacity < 0 || fillOpacity > 1 || strokeOpacity < 0 || strokeOpacity > 1) throw new Error('Invalid SVG paint opacity')
  return { ...(fillGradient ? { fillGradient: structuredClone(fillGradient) } : {}), ...(cap ? { strokeCap: cap as NonNullable<VectorStyle['strokeCap']> } : {}), ...(join ? { strokeJoin: join as NonNullable<VectorStyle['strokeJoin']> } : {}), ...(dash && dash !== 'none' ? { strokeDash: dash.trim().split(/[\s,]+/).map(Number) } : parent.strokeDash ? { strokeDash: [...parent.strokeDash] } : {}), ...(value('vector-effect') === 'non-scaling-stroke' ? { scaleStroke: false } : {}), fill: gradientId ? null : color('fill', parent.fill), stroke: color('stroke', parent.stroke), strokeWidth: numericValue(value('stroke-width'), 'stroke-width', parent.strokeWidth), fillRule: fillRule as VectorStyle['fillRule'] || parent.fillRule, fillOpacity, strokeOpacity }
}

function readGeometry(element: Element): VectorGeometry {
  switch (element.localName) {
    case 'path': {
      const d = element.getAttribute('d') || ''
      if (d.length > 1_000_000 || /[^\d\s.,+\-eEaAcChHlLmMqQsStTvVzZ]/.test(d)) throw new Error('Invalid or oversized SVG path')
      return { type: 'path', d }
    }
    case 'rect': return { type: 'rect', x: numeric(element, 'x'), y: numeric(element, 'y'), width: numeric(element, 'width'), height: numeric(element, 'height'), rx: numeric(element, 'rx'), ry: numeric(element, 'ry') }
    case 'circle': return { type: 'circle', cx: numeric(element, 'cx'), cy: numeric(element, 'cy'), r: numeric(element, 'r') }
    case 'ellipse': return { type: 'ellipse', cx: numeric(element, 'cx'), cy: numeric(element, 'cy'), rx: numeric(element, 'rx'), ry: numeric(element, 'ry') }
    case 'line': return { type: 'line', x1: numeric(element, 'x1'), y1: numeric(element, 'y1'), x2: numeric(element, 'x2'), y2: numeric(element, 'y2') }
    case 'polyline': case 'polygon': {
      const raw = element.getAttribute('points') || ''
      if (raw.length > 1_000_000 || /[^\d\s.,+\-eE]/.test(raw)) throw new Error('Invalid SVG polygon')
      const points = raw.trim().split(/[\s,]+/).filter(Boolean).map(Number)
      if (points.length < (element.localName === 'polyline' ? 4 : 6) || points.length % 2 || points.some((v) => !Number.isFinite(v))) throw new Error('Invalid SVG polygon points')
      if (element.localName === 'polyline') return { type: 'path', d: `M ${points[0]} ${points[1]} ` + points.slice(2).reduce<string[]>((parts, n, i) => { if (i % 2 === 0) parts.push(`L ${n} ${points[i + 3]}`); return parts }, []).join(' ') }
      return { type: 'polygon', points }
    }
    default: throw new Error('Unsupported SVG geometry')
  }
}

function parseTransform(raw: string | null): AffineMatrix | undefined {
  if (!raw) return undefined
  let result: AffineMatrix = [1, 0, 0, 1, 0, 0]
  const pattern = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g
  let consumed = ''
  for (const match of raw.matchAll(pattern)) {
    consumed += match[0]
    const args = match[2]!.trim().split(/[\s,]+/).map(Number)
    if (args.some((v) => !Number.isFinite(v))) throw new Error('Invalid SVG transform')
    let next: AffineMatrix
    if (match[1] === 'matrix' && args.length === 6) next = args as AffineMatrix
    else if (match[1] === 'translate' && args.length >= 1 && args.length <= 2) next = [1, 0, 0, 1, args[0]!, args[1] ?? 0]
    else if (match[1] === 'scale' && args.length >= 1 && args.length <= 2) next = [args[0]!, 0, 0, args[1] ?? args[0]!, 0, 0]
    else if ((match[1] === 'skewX' || match[1] === 'skewY') && args.length === 1) { const skew = Math.tan(args[0]! * Math.PI / 180); next = match[1] === 'skewX' ? [1, 0, skew, 1, 0, 0] : [1, skew, 0, 1, 0, 0] }
    else if (match[1] === 'rotate' && (args.length === 1 || args.length === 3)) { const radians = args[0]! * Math.PI / 180; next = [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0]; if (args.length === 3) next = multiply(multiply([1, 0, 0, 1, args[1]!, args[2]!], next), [1, 0, 0, 1, -args[1]!, -args[2]!]) }
    else throw new Error('Unsupported SVG transform')
    result = multiply(result, next)
  }
  if (consumed.replace(/\s/g, '') !== raw.replace(/\s/g, '')) throw new Error('Unsupported SVG transform')
  return result
}

function multiply(a: AffineMatrix, b: AffineMatrix): AffineMatrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]
}

function readGradients(root: Element): Map<string, VectorGradient> {
  const gradients = new Map<string, VectorGradient>()
  for (const element of Array.from(root.querySelectorAll('linearGradient, radialGradient'))) {
    const id = element.getAttribute('id')
    if (!id || !/^[A-Za-z_][\w.-]*$/.test(id) || gradients.has(id)) throw new Error('Invalid or duplicate SVG gradient ID')
    const transform = parseTransform(element.getAttribute('gradientTransform'))
    const coord = (key: string, fallback: number): number => {
      const raw = element.getAttribute(key)
      if (raw === null) return fallback
      return raw.endsWith('%') ? numericValue(raw.slice(0, -1), key) / 100 : numericValue(raw, key)
    }
    const radial = element.localName === 'radialGradient', units = element.getAttribute('gradientUnits') ?? 'objectBoundingBox'
    if (units !== 'objectBoundingBox' && units !== 'userSpaceOnUse') throw new Error('Invalid gradient units')
    const start = radial ? { x: coord('cx', .5), y: coord('cy', .5) } : { x: coord('x1', 0), y: coord('y1', 0) }
    const focus = radial ? { x: coord('fx', start.x), y: coord('fy', start.y) } : undefined
    if (radial && coord('r', .5) < 0) throw new Error('Invalid radial gradient radius')
    const end = radial ? { x: start.x + coord('r', .5), y: start.y } : { x: coord('x2', 1), y: coord('y2', 0) }
    const stops = Array.from(element.children).filter(child => child.localName === 'stop').map(stop => {
      const style = parseSvgDeclarations(stop.getAttribute('style') ?? '', [], 'inline')
      const rawOffset = stop.getAttribute('offset') ?? '0', offset = Number.parseFloat(rawOffset) / (rawOffset.endsWith('%') ? 100 : 1)
      const color = style.get('stop-color') ?? stop.getAttribute('stop-color') ?? '#000000'
      const opacity = numericValue(style.get('stop-opacity') ?? stop.getAttribute('stop-opacity'), 'stop-opacity', 1)
      return { offset, color, opacity }
    })
    gradients.set(id, { type: radial ? 'radial' : 'linear', units, ...(transform ? { transform } : {}), ...(focus ? { focus } : {}), start, end, stops })
  }
  return gradients
}
