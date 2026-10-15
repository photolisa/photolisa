import type { Rect } from './ObjectTransform'
import type { Point } from '../geometry/LayerCoordinates'
export interface SpacingMeasurement {
  from: Point
  to: Point
  distance: number
}
/** Nearest separated neighbors on each side, measured in document pixels. */
export function spacingMeasurements(
  selection: Rect,
  objects: readonly Rect[],
  maximum: number,
): SpacingMeasurement[] {
  const nearest = new Map<string, SpacingMeasurement>()
  const add = (
    side: string,
    from: Point,
    to: Point,
    distance: number,
  ): void => {
    if (
      distance <= 0 ||
      distance > maximum ||
      (nearest.get(side)?.distance ?? Infinity) <= distance
    )
      return
    nearest.set(side, { from, to, distance })
  }
  for (const other of objects) {
    const top = Math.max(selection.y, other.y),
      bottom = Math.min(selection.y + selection.height, other.y + other.height)
    if (top < bottom) {
      const y = (top + bottom) / 2
      add(
        'right',
        { x: selection.x + selection.width, y },
        { x: other.x, y },
        other.x - selection.x - selection.width,
      )
      add(
        'left',
        { x: other.x + other.width, y },
        { x: selection.x, y },
        selection.x - other.x - other.width,
      )
    }
    const left = Math.max(selection.x, other.x),
      right = Math.min(selection.x + selection.width, other.x + other.width)
    if (left < right) {
      const x = (left + right) / 2
      add(
        'bottom',
        { x, y: selection.y + selection.height },
        { x, y: other.y },
        other.y - selection.y - selection.height,
      )
      add(
        'top',
        { x, y: other.y + other.height },
        { x, y: selection.y },
        selection.y - other.y - other.height,
      )
    }
  }
  return [...nearest.values()]
}
