import { fillVectorGradient } from '../renderer/VectorGradient'
import type { AffineMatrix, VectorLayer } from '../core/model/types'
import { toPathData, readSubpaths } from '../core/vector/PathGeometry'
import { arrowPolygons } from '../core/vector/VectorPaint'
export function applySvgMatrix(context: CanvasRenderingContext2D, matrix?: AffineMatrix): void { if (matrix) context.transform(...matrix) }
export function paintVector(context: CanvasRenderingContext2D, layer: VectorLayer): void {
  const style = layer.style, path = new Path2D(toPathData(layer.geometry))
  if (style.fill || style.fillGradient) {
    context.save(); context.globalAlpha *= style.fillOpacity ?? 1
    if (style.fillGradient) {
      fillVectorGradient(context, layer, path)
    } else { context.fillStyle = style.fill!; context.fill(path, style.fillRule) }
    context.restore()
  }
  if (style.stroke && style.strokeWidth > 0) {
    context.save(); context.globalAlpha *= style.strokeOpacity ?? 1; context.strokeStyle = style.stroke; context.lineWidth = style.strokeWidth
    if (style.scaleStroke === false) { const m = context.getTransform(); context.lineWidth /= Math.max(.001, Math.sqrt(Math.abs(m.a * m.d - m.b * m.c))) }
    context.lineCap = style.strokeCap ?? 'butt'; context.lineJoin = style.strokeJoin ?? 'miter'; context.setLineDash(style.strokeDash ?? [])
    const closed = readSubpaths(layer.geometry).every(p => p.closed)
    if (closed && style.strokeAlignment && style.strokeAlignment !== 'center') {
      context.lineWidth *= 2
      if (style.strokeAlignment === 'inside') context.clip(path, style.fillRule)
      else { const outside = new Path2D(); outside.rect(-2_000_000, -2_000_000, 4_000_000, 4_000_000); outside.addPath(path); context.clip(outside, 'evenodd') }
    }
    context.stroke(path); context.restore()
    context.save(); context.globalAlpha *= style.strokeOpacity ?? 1; context.fillStyle = style.stroke
    const m = context.getTransform(), scale = style.scaleStroke === false ? Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) : 1
    for (const arrow of arrowPolygons(layer, scale)) { context.beginPath(); context.moveTo(arrow[0]!, arrow[1]!); for (let i = 2; i < arrow.length; i += 2) context.lineTo(arrow[i]!, arrow[i + 1]!); context.closePath(); context.fill() }
    context.restore()
  }
}
