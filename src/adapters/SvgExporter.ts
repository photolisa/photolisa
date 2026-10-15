import { arrowPolygons } from '../core/vector/VectorPaint'
import { toPathData } from '../core/vector/PathGeometry'
import { booleanGroupResult } from '../core/vector/BooleanGroup'
import type { EditorDocument } from '../core/model/EditorDocument'
import type { Layer, VectorGeometry, VectorLayer } from '../core/model/types'
import { rasterSources, type RasterSourceRegistry } from '../raster/RasterSourceRegistry'
import { validateVectorStyle } from '../core/model/VectorGeometry'
import { loadTextFont, paintTextLayer } from '../raster/TextPainter'

export interface SvgExportResult { blob: Blob; warnings: string[] }

export class SvgExporter {
  constructor(private readonly sources: RasterSourceRegistry = rasterSources) {}

  async export(document: EditorDocument, selectionOnly = false): Promise<SvgExportResult> {
    const warnings: string[] = []
    const layers = await Promise.all((selectionOnly ? selectedTree(document.layers, new Set(document.selectedLayerIds)) : document.layers).map((layer) => this.serializeLayer(layer, warnings)))
    const { width, height } = document.dimensions
    const background = !selectionOnly && document.background === 'white' ? `<rect width="${width}" height="${height}" fill="#ffffff"/>` : ''
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${background}${layers.join('')}</svg>`
    return { blob: new Blob([xml], { type: 'image/svg+xml' }), warnings: [...new Set(warnings)] }
  }

  private async serializeLayer(layer: Layer, warnings: string[]): Promise<string> {
    const transform = layer.transform
    const movement = `translate(${num(transform.x)} ${num(transform.y)}) rotate(${num(transform.rotation * 180 / Math.PI)}) scale(${num(transform.scaleX)} ${num(transform.scaleY)})`
    const affine = layer.svgMatrix ? ` matrix(${layer.svgMatrix.map(num).join(' ')})` : ''
    const attrs = ` opacity="${num(layer.opacity)}"${layer.visible ? '' : ' display="none"'} transform="${movement}${affine}"`
    let body: string
    if (layer.kind === 'group' && layer.booleanOperation) body = serializeShape(booleanGroupResult(layer))
    else if (layer.kind === 'group') body = (await Promise.all(layer.children.map((child) => this.serializeLayer(child, warnings)))).join('')
    else if (layer.kind === 'vector') body = serializeShape(layer)
    else if (layer.kind === 'text') {
      await loadTextFont(layer)
      const canvas = paintTextLayer(layer)
      body = `<image width="${canvas.width}" height="${canvas.height}" href="${escapeXml(canvas.toDataURL('image/png'))}"/>`
      warnings.push(`Text layer “${layer.name}” was embedded as PNG data in the SVG; editability was lost.`)
    }
    else {
      if (!layer.pixelSourceId) return ''
      if (layer.adjustments.some((adjustment) => adjustment.enabled) || layer.mask?.enabled) throw new Error(`SVG export cannot preserve adjustment or mask on “${layer.name}”; export a PNG instead.`)
      const source = this.sources.get(layer.pixelSourceId)
      if (!source) throw new Error(`Missing pixels for layer “${layer.name}”.`)
      const canvas = document.createElement('canvas')
      canvas.width = source.width; canvas.height = source.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas is unavailable for embedded SVG raster data')
      context.drawImage(source.image, 0, 0)
      const data = canvas.toDataURL('image/png')
      body = `<image width="${source.width}" height="${source.height}" href="${escapeXml(data)}"/>`
      if (layer.crop) {
        const crop = layer.crop, clipId = `image-crop-${layer.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`
        body = `<defs><clipPath id="${clipId}"><rect x="${num(crop.x)}" y="${num(crop.y)}" width="${num(crop.width)}" height="${num(crop.height)}"/></clipPath></defs><g clip-path="url(#${clipId})"><g transform="translate(${num(crop.offsetX)} ${num(crop.offsetY)})">${body}</g></g>`
      }
      warnings.push(`Raster layer “${layer.name}” was embedded as PNG data in the SVG.`)
    }
    if (layer.blendMode !== 'normal') throw new Error(`SVG export cannot preserve ${layer.blendMode} blend mode on “${layer.name}”; export a PNG instead.`)
    if (layer.adjustments.some((adjustment) => adjustment.enabled)) throw new Error(`SVG export cannot preserve adjustments on “${layer.name}”; export a PNG instead.`)
    if (layer.mask?.enabled) throw new Error(`SVG export cannot preserve mask on “${layer.name}”; export a PNG instead.`)
    return `<g${attrs}><title>${escapeXml(layer.name)}</title>${body}</g>`
  }
}

export function serializeShape(layer: VectorLayer): string {
  const style = layer.style
  validateVectorStyle(style)
  const gradient = style.fillGradient
  const gradientId = `gradient-${layer.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`
  const gradientMarkup = gradient ? `<defs><${gradient.type === 'linear' ? 'linearGradient' : 'radialGradient'} id="${gradientId}" gradientUnits="${gradient.units ?? 'objectBoundingBox'}"${gradient.transform ? ` gradientTransform="matrix(${gradient.transform.map(num).join(' ')})"` : ''} ${gradient.type === 'linear' ? `x1="${num(gradient.start.x)}" y1="${num(gradient.start.y)}" x2="${num(gradient.end.x)}" y2="${num(gradient.end.y)}"` : `fx="${num((gradient.focus ?? gradient.start).x)}" fy="${num((gradient.focus ?? gradient.start).y)}" cx="${num(gradient.start.x)}" cy="${num(gradient.start.y)}" r="${num(Math.hypot(gradient.end.x - gradient.start.x, gradient.end.y - gradient.start.y))}"`}>${gradient.stops.map(stop => `<stop offset="${num(stop.offset)}" stop-color="${escapeXml(stop.color)}" stop-opacity="${num(stop.opacity ?? 1)}"/>`).join('')}</${gradient.type === 'linear' ? 'linearGradient' : 'radialGradient'}></defs>` : ''
  const strokeExtras = ` stroke-linecap="${style.strokeCap ?? 'butt'}" stroke-linejoin="${style.strokeJoin ?? 'miter'}"${style.strokeDash?.length ? ` stroke-dasharray="${style.strokeDash.map(num).join(' ')}"` : ''}${style.scaleStroke === false ? ' vector-effect="non-scaling-stroke"' : ''}`
  const attrs = ` fill="${gradient ? `url(#${gradientId})` : escapeXml(style.fill ?? 'none')}" stroke="${escapeXml(style.stroke ?? 'none')}" stroke-width="${num(style.strokeWidth)}" fill-rule="${escapeXml(style.fillRule)}" fill-opacity="${num(style.fillOpacity ?? 1)}" stroke-opacity="${num(style.strokeOpacity ?? 1)}"`
  const geometry = layer.geometry
  const arrows = style.stroke ? arrowPolygons(layer).map(points => `<polygon points="${points.map(num).join(' ')}" fill="${escapeXml(style.stroke!)}" opacity="${num(style.strokeOpacity ?? 1)}"/>`).join('') : ''
  if (style.stroke && style.strokeAlignment && style.strokeAlignment !== 'center') {
    const clipId = `clip-${layer.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`, d = toPathData(geometry)
    const clipD = style.strokeAlignment === 'outside' ? `M-2000000 -2000000 H2000000 V2000000 H-2000000 Z ${d}` : d
    const clip = `<defs><clipPath id="${clipId}"><path d="${escapeXml(clipD)}" clip-rule="${style.strokeAlignment === 'outside' ? 'evenodd' : style.fillRule}"/></clipPath></defs>`
    return `${gradientMarkup}${clip}<${geometry.type}${geometryAttributes(geometry)}${attrs.replace(/ stroke="[^"]*"/, ' stroke="none"')}/><path d="${escapeXml(d)}" data-photolisa-stroke-alignment="${style.strokeAlignment}" fill="none" stroke="${escapeXml(style.stroke)}" stroke-width="${num(style.strokeWidth * 2)}" stroke-opacity="${num(style.strokeOpacity ?? 1)}"${strokeExtras} clip-path="url(#${clipId})"/>${arrows}`
  }
  return `${gradientMarkup}<${geometry.type}${geometryAttributes(geometry)}${attrs}${strokeExtras}/>${arrows}`
}

function geometryAttributes(shape: VectorGeometry): string {
  switch (shape.type) {
    case 'path': return ` d="${escapeXml(shape.d)}"`
    case 'rect': return ` x="${num(shape.x)}" y="${num(shape.y)}" width="${num(shape.width)}" height="${num(shape.height)}" rx="${num(shape.rx)}" ry="${num(shape.ry)}"`
    case 'circle': return ` cx="${num(shape.cx)}" cy="${num(shape.cy)}" r="${num(shape.r)}"`
    case 'ellipse': return ` cx="${num(shape.cx)}" cy="${num(shape.cy)}" rx="${num(shape.rx)}" ry="${num(shape.ry)}"`
    case 'line': return ` x1="${num(shape.x1)}" y1="${num(shape.y1)}" x2="${num(shape.x2)}" y2="${num(shape.y2)}"`
    case 'polygon': return ` points="${shape.points.map(num).join(' ')}"`
  }
}

function num(value: number): string { if (!Number.isFinite(value)) throw new Error('SVG contains non-finite geometry'); return String(value) }
function escapeXml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!) }

function selectedTree(layers: readonly Layer[], selected: Set<string>): Layer[] {
  return layers.flatMap(layer => selected.has(layer.id) ? [layer] : layer.kind === 'group' ? (() => { const children = selectedTree(layer.children, selected); return children.length ? [{ ...layer, children }] : [] })() : [])
}
