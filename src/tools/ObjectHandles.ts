import {
  framePoints,
  unionBounds,
  worldBounds,
  type TransformFrame,
} from '../core/transform/ObjectTransform'
import {
  IDENTITY_MATRIX,
  transformPoint,
  type Point,
} from '../core/geometry/LayerCoordinates'
import type { ObjectEntry } from './ObjectBounds'

export function selectionFrame(
  entries: readonly ObjectEntry[],
): TransformFrame | null {
  if (!entries.length) return null
  if (entries.length === 1)
    return { bounds: entries[0]!.bounds, matrix: entries[0]!.world }
  return {
    bounds: unionBounds(
      entries.map((e) => worldBounds({ bounds: e.bounds, matrix: e.world })),
    ),
    matrix: [...IDENTITY_MATRIX],
  }
}
export function rotationHandles(frame: TransformFrame, zoom: number): Point[] {
  const points = framePoints(frame),
    center = transformPoint(frame.matrix, {
      x: frame.bounds.x + frame.bounds.width / 2,
      y: frame.bounds.y + frame.bounds.height / 2,
    })
  return [0, 2, 4, 6].map((i) => {
    const p = points[i]!,
      distance = Math.max(0.001, Math.hypot(p.x - center.x, p.y - center.y))
    return {
      x: p.x + (((p.x - center.x) / distance) * 22) / zoom,
      y: p.y + (((p.y - center.y) / distance) * 22) / zoom,
    }
  })
}
export function rectangleRadiusHandle(entry: ObjectEntry, zoom: number): Point {
  if (entry.layer.kind !== 'vector' || entry.layer.geometry.type !== 'rect')
    return { x: 0, y: 0 }
  const geometry = entry.layer.geometry,
    gap = 12 / Math.max(0.01, zoom * Math.hypot(entry.world[0], entry.world[1]))
  return transformPoint(entry.world, {
    x: geometry.x + Math.min(geometry.width / 2, Math.max(gap, geometry.rx)),
    y: geometry.y + Math.min(geometry.height / 2, Math.max(gap, geometry.ry)),
  })
}
