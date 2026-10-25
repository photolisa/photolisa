import type { Point } from '../geometry/LayerCoordinates'
import { unionBounds, type Rect } from './ObjectTransform'

export type AlignEdge =
  'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom'
export type AlignOperation =
  AlignEdge | 'distribute-x' | 'distribute-y' | 'spacing-x' | 'spacing-y'
export type LayerAlignmentAction =
  `align-${AlignOperation}` | `canvas-${AlignEdge}`
export interface AlignmentItem {
  id: string
  bounds: Rect
}
export const ALIGN_OPERATIONS: readonly AlignOperation[] = [
  'left',
  'center-x',
  'right',
  'top',
  'center-y',
  'bottom',
  'distribute-x',
  'distribute-y',
  'spacing-x',
  'spacing-y',
]
export function isLayerAlignmentAction(
  action: string,
): action is LayerAlignmentAction {
  return ALIGN_OPERATIONS.some(
    (op) =>
      action === `align-${op}` ||
      (!op.startsWith('distribute') &&
        !op.startsWith('spacing') &&
        action === `canvas-${op}`),
  )
}

/** Compute world-space translations without changing geometry or source pixels. */
export function layerAlignmentDeltas(
  items: readonly AlignmentItem[],
  operation: AlignOperation,
  canvas?: Rect,
): Map<string, Point> {
  const result = new Map<string, Point>()
  if (!items.length) return result
  if (
    items.some(
      ({ bounds: b }) =>
        ![b.x, b.y, b.width, b.height].every(Number.isFinite) ||
        b.width < 0 ||
        b.height < 0,
    )
  )
    throw new Error('Cannot align layers with invalid bounds')
  const area = canvas ?? unionBounds(items.map((i) => i.bounds))
  if (![area.x, area.y, area.width, area.height].every(Number.isFinite))
    throw new Error('Invalid alignment area')
  const move = (id: string, x: number, y: number): void => {
    if (Math.abs(x) > 1e-8 || Math.abs(y) > 1e-8) result.set(id, { x, y })
  }
  if (operation.startsWith('distribute') || operation.startsWith('spacing')) {
    if (items.length < 3) return result
    const axis = operation.endsWith('x') ? 'x' : 'y'
    const size = axis === 'x' ? 'width' : 'height'
    const equalGaps = operation.startsWith('spacing')
    const sorted = [...items].sort(
      (a, b) =>
        a.bounds[axis] +
        (equalGaps ? 0 : a.bounds[size] / 2) -
        (b.bounds[axis] + (equalGaps ? 0 : b.bounds[size] / 2)),
    )
    const first = sorted[0],
      last = sorted.at(-1)
    if (!first || !last) return result
    const gap =
      (last.bounds[axis] +
        last.bounds[size] -
        first.bounds[axis] -
        sorted.reduce((sum, i) => sum + i.bounds[size], 0)) /
      (sorted.length - 1)
    const centerStep =
      (last.bounds[axis] +
        last.bounds[size] / 2 -
        first.bounds[axis] -
        first.bounds[size] / 2) /
      (sorted.length - 1)
    let position = first.bounds[axis]
    sorted.forEach((item, index) => {
      const target = equalGaps
        ? position
        : first.bounds[axis] +
          first.bounds[size] / 2 +
          index * centerStep -
          item.bounds[size] / 2
      if (index > 0 && index < sorted.length - 1)
        move(
          item.id,
          axis === 'x' ? target - item.bounds.x : 0,
          axis === 'y' ? target - item.bounds.y : 0,
        )
      position += item.bounds[size] + gap
    })
    return result
  }
  for (const { id, bounds: b } of items)
    move(
      id,
      operation === 'left'
        ? area.x - b.x
        : operation === 'right'
          ? area.x + area.width - b.x - b.width
          : operation === 'center-x'
            ? area.x + area.width / 2 - b.x - b.width / 2
            : 0,
      operation === 'top'
        ? area.y - b.y
        : operation === 'bottom'
          ? area.y + area.height - b.y - b.height
          : operation === 'center-y'
            ? area.y + area.height / 2 - b.y - b.height / 2
            : 0,
    )
  return result
}
