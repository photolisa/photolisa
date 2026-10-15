import { multiplyAffine, IDENTITY_MATRIX } from '../geometry/LayerCoordinates'
import type { AffineMatrix } from '../model/types'
import type { VectorLayer, VectorGradient } from '../model/types'
import { geometryBounds, readSubpaths } from './PathGeometry'
import type { Point } from '../geometry/LayerCoordinates'
export function gradientCoordinates(
  layer: VectorLayer,
  gradient: VectorGradient,
): { start: Point; end: Point } {
  if (gradient.units === 'userSpaceOnUse')
    return { start: gradient.start, end: gradient.end }
  const b = geometryBounds(layer.geometry)
  return {
    start: {
      x: b.x + gradient.start.x * b.width,
      y: b.y + gradient.start.y * b.height,
    },
    end: {
      x: b.x + gradient.end.x * b.width,
      y: b.y + gradient.end.y * b.height,
    },
  }
}
export function gradientFrame(
  layer: VectorLayer,
  gradient: VectorGradient,
): AffineMatrix {
  const b = geometryBounds(layer.geometry)
  const frame: AffineMatrix =
    gradient.units === 'userSpaceOnUse'
      ? IDENTITY_MATRIX
      : [Math.max(0.001, b.width), 0, 0, Math.max(0.001, b.height), b.x, b.y]
  return multiplyAffine(frame, gradient.transform ?? IDENTITY_MATRIX)
}
export function arrowPolygons(layer: VectorLayer, renderScale = 1): number[][] {
  if (!layer.style.startArrow && !layer.style.endArrow) return []
  const paths = readSubpaths(layer.geometry),
    size =
      Math.max(6, layer.style.strokeWidth * 4) / Math.max(0.001, renderScale)
  const triangle = (tip: Point, toward: Point): number[] => {
    const angle = Math.atan2(toward.y - tip.y, toward.x - tip.x),
      dx = Math.cos(angle) * size,
      dy = Math.sin(angle) * size
    return [
      tip.x,
      tip.y,
      tip.x + dx - dy * 0.45,
      tip.y + dy + dx * 0.45,
      tip.x + dx + dy * 0.45,
      tip.y + dy - dx * 0.45,
    ]
  }
  return paths
    .filter((p) => !p.closed && p.anchors.length >= 2)
    .flatMap((p) => {
      const first = p.anchors[0]!,
        last = p.anchors.at(-1)!,
        result: number[][] = []
      if (layer.style.startArrow)
        result.push(
          triangle(
            first.point,
            first.outgoing.x !== first.point.x ||
              first.outgoing.y !== first.point.y
              ? first.outgoing
              : p.anchors[1]!.point,
          ),
        )
      if (layer.style.endArrow)
        result.push(
          triangle(
            last.point,
            last.incoming.x !== last.point.x || last.incoming.y !== last.point.y
              ? last.incoming
              : p.anchors.at(-2)!.point,
          ),
        )
      return result
    })
}
