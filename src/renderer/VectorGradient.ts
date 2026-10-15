import { Color } from 'pixi.js'
import type { VectorGradient, VectorLayer } from '../core/model/types'
import { gradientFrame } from '../core/vector/VectorPaint'
import { invertAffine } from '../core/geometry/LayerCoordinates'

function createGradient(
  context: CanvasRenderingContext2D,
  gradient: VectorGradient,
): CanvasGradient {
  const { start, end } = gradient,
    focus = gradient.focus ?? start
  const paint =
    gradient.type === 'linear'
      ? context.createLinearGradient(start.x, start.y, end.x, end.y)
      : context.createRadialGradient(
          focus.x,
          focus.y,
          0,
          start.x,
          start.y,
          Math.max(0.000001, Math.hypot(end.x - start.x, end.y - start.y)),
        )
  gradient.stops.forEach((stop) => {
    const color = new Color(stop.color)
    paint.addColorStop(
      stop.offset,
      color.setAlpha(color.alpha * (stop.opacity ?? 1)).toRgbaString(),
    )
  })
  return paint
}
/** Draw in gradient coordinates, keeping the exact original vector contour via an inverse matrix. */
export function fillVectorGradient(
  context: CanvasRenderingContext2D,
  layer: VectorLayer,
  path: Path2D,
  fillRule: CanvasFillRule = layer.style.fillRule,
): void {
  const gradient = layer.style.fillGradient
  if (!gradient) return
  const matrix = gradientFrame(layer, gradient)
  context.save()
  try {
    const inverse = invertAffine(matrix),
      transformed = new Path2D()
    transformed.addPath(path, new DOMMatrix(inverse))
    context.transform(...matrix)
    context.fillStyle = createGradient(context, gradient)
    context.fill(transformed, fillRule)
  } finally {
    context.restore()
  }
}
