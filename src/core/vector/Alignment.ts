import type { AffineMatrix, LayerTransform, VectorLayer } from '../model/types'
import { geometryBounds, type Bounds } from './PathGeometry'
import { invertAffine, transformPoint } from '../geometry/LayerCoordinates'
export type AlignmentAction =
  | 'left'
  | 'center-x'
  | 'right'
  | 'top'
  | 'center-y'
  | 'bottom'
  | 'distribute-x'
  | 'distribute-y'
  | 'spacing-x'
  | 'spacing-y'
  | 'match-width'
  | 'match-height'
export interface AlignmentEntry {
  layer: VectorLayer
  world: AffineMatrix
  parent: AffineMatrix
}
export function worldBounds(entry: AlignmentEntry): Bounds {
  const b = geometryBounds(entry.layer.geometry)
  const corners = [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x, y: b.y + b.height },
    { x: b.x + b.width, y: b.y + b.height },
  ].map((p) => transformPoint(entry.world, p))
  const x = Math.min(...corners.map((p) => p.x)),
    y = Math.min(...corners.map((p) => p.y))
  return {
    x,
    y,
    width: Math.max(...corners.map((p) => p.x)) - x,
    height: Math.max(...corners.map((p) => p.y)) - y,
  }
}
export function alignmentTransforms(
  entries: AlignmentEntry[],
  action: AlignmentAction,
  canvas?: Bounds,
): Map<string, LayerTransform> {
  const result = new Map<string, LayerTransform>()
  if (!entries.length) return result
  const items = entries.map((entry) => ({ entry, bounds: worldBounds(entry) }))
  const x = Math.min(...items.map((i) => i.bounds.x)),
    y = Math.min(...items.map((i) => i.bounds.y))
  const area = canvas ?? {
    x,
    y,
    width: Math.max(...items.map((i) => i.bounds.x + i.bounds.width)) - x,
    height: Math.max(...items.map((i) => i.bounds.y + i.bounds.height)) - y,
  }
  const move = (entry: AlignmentEntry, dx: number, dy: number): void => {
    const inverse = invertAffine(entry.parent),
      origin = transformPoint(inverse, { x: 0, y: 0 }),
      delta = transformPoint(inverse, { x: dx, y: dy })
    result.set(entry.layer.id, {
      ...entry.layer.transform,
      x: entry.layer.transform.x + delta.x - origin.x,
      y: entry.layer.transform.y + delta.y - origin.y,
    })
  }
  if (action.startsWith('distribute') || action.startsWith('spacing')) {
    if (items.length < 3) return result
    const horizontal = action.endsWith('x'),
      axis = horizontal ? 'x' : 'y',
      size = horizontal ? 'width' : 'height'
    items.sort((a, b) => a.bounds[axis] - b.bounds[axis])
    const first = items[0]!,
      last = items.at(-1)!,
      gap =
        (last.bounds[axis] +
          last.bounds[size] -
          first.bounds[axis] -
          items.reduce((sum, i) => sum + i.bounds[size], 0)) /
        (items.length - 1)
    let position = first.bounds[axis]
    items.forEach((item, index) => {
      const target = action.startsWith('spacing')
        ? position
        : first.bounds[axis] +
          first.bounds[size] / 2 +
          (index *
            (last.bounds[axis] +
              last.bounds[size] / 2 -
              first.bounds[axis] -
              first.bounds[size] / 2)) /
            (items.length - 1) -
          item.bounds[size] / 2
      move(
        item.entry,
        horizontal ? target - item.bounds.x : 0,
        horizontal ? 0 : target - item.bounds.y,
      )
      position += item.bounds[size] + gap
    })
  } else
    for (const { entry, bounds: b } of items) {
      if (action === 'match-width' || action === 'match-height') {
        const dimension = action === 'match-width' ? 'width' : 'height',
          scale = action === 'match-width' ? 'scaleX' : 'scaleY'
        const size = geometryBounds(entry.layer.geometry)[dimension],
          target =
            geometryBounds(entries[0]!.layer.geometry)[dimension] *
            Math.abs(entries[0]!.layer.transform[scale])
        if (size > 0)
          result.set(entry.layer.id, {
            ...entry.layer.transform,
            [scale]:
              (Math.sign(entry.layer.transform[scale] || 1) * target) / size,
          })
      } else
        move(
          entry,
          action === 'left'
            ? area.x - b.x
            : action === 'right'
              ? area.x + area.width - b.x - b.width
              : action === 'center-x'
                ? area.x + area.width / 2 - b.x - b.width / 2
                : 0,
          action === 'top'
            ? area.y - b.y
            : action === 'bottom'
              ? area.y + area.height - b.y - b.height
              : action === 'center-y'
                ? area.y + area.height / 2 - b.y - b.height / 2
                : 0,
        )
    }
  return result
}
