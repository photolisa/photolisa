import { snapBounds, type Rect, type SnapDelta } from './ObjectTransform'
import { spacingMeasurements, type SpacingMeasurement } from './SmartGuides'
import type { Point } from '../geometry/LayerCoordinates'

type Axis = 'x' | 'y'
export interface AlignmentGuide {
  from: Point
  to: Point
  kind: 'edge' | 'center' | 'canvas' | 'custom'
}
export interface SmartSnapResult extends SnapDelta {
  lines: AlignmentGuide[]
  measurements: SpacingMeasurement[]
  lock: SnapLock
}
export interface SnapLock {
  x: number | null
  y: number | null
}
export interface SmartSnapScene {
  objects: readonly Rect[]
  byX: readonly Rect[]
  byY: readonly Rect[]
}
export interface SmartSnapOptions {
  tolerance: number
  zoom: number
  width: number
  height: number
  grid: number
  guidesX: readonly number[]
  guidesY: readonly number[]
  axis?: Axis | undefined
  previous?: SnapLock | undefined
}

const EPSILON = 1e-7
const validRect = (r: Rect): boolean =>
  [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
  r.width > 0 &&
  r.height > 0
const anchors = (r: Rect, axis: Axis): number[] => {
  const size = axis === 'x' ? r.width : r.height
  return [r[axis], r[axis] + size / 2, r[axis] + size]
}

/** Cache geometry and ordering once per gesture; pointer frames do linear scans only. */
export function createSmartSnapScene(objects: readonly Rect[]): SmartSnapScene {
  const valid = objects.filter(validRect)
  return {
    objects: valid,
    byX: [...valid].sort((a, b) => a.x - b.x),
    byY: [...valid].sort((a, b) => a.y - b.y),
  }
}

interface GapCandidate {
  delta: number
  measurements: SpacingMeasurement[]
}

/** Match a gap between neighbors, or repeat a neighboring pair's gap on either end. */
function gapCandidates(
  bounds: Rect,
  sorted: readonly Rect[],
  axis: Axis,
): GapCandidate[] {
  const cross = axis === 'x' ? 'y' : 'x'
  const size = axis === 'x' ? 'width' : 'height'
  const crossSize = axis === 'x' ? 'height' : 'width'
  const peers = sorted.filter(
    (r) =>
      Math.min(bounds[cross] + bounds[crossSize], r[cross] + r[crossSize]) >
      Math.max(bounds[cross], r[cross]),
  )
  const result: GapCandidate[] = []
  const measure = (a: Rect, b: Rect): SpacingMeasurement => {
    const crossPosition =
      (Math.max(a[cross], b[cross]) +
        Math.min(a[cross] + a[crossSize], b[cross] + b[crossSize])) /
      2
    const from =
      axis === 'x'
        ? { x: a.x + a.width, y: crossPosition }
        : { x: crossPosition, y: a.y + a.height }
    const to =
      axis === 'x' ? { x: b.x, y: crossPosition } : { x: crossPosition, y: b.y }
    return { from, to, distance: b[axis] - a[axis] - a[size], equal: true }
  }
  for (let i = 1; i < peers.length; i++) {
    const a = peers[i - 1],
      b = peers[i]
    if (!a || !b) continue
    const gap = b[axis] - a[axis] - a[size]
    if (
      gap <= 0 ||
      Math.min(
        a[cross] + a[crossSize],
        b[cross] + b[crossSize],
        bounds[cross] + bounds[crossSize],
      ) <= Math.max(a[cross], b[cross], bounds[cross])
    )
      continue
    const offer = (
      position: number,
      order: 'between' | 'before' | 'after',
    ): void => {
      const moved = { ...bounds, [axis]: position }
      // Do not jump over a closer object to repeat a distant gap.
      const blocked =
        order === 'before'
          ? peers[i - 2]
          : order === 'after'
            ? peers[i + 1]
            : undefined
      if (
        blocked &&
        (order === 'before'
          ? moved[axis] < blocked[axis] + blocked[size]
          : moved[axis] + moved[size] > blocked[axis])
      )
        return
      const measurements =
        order === 'between'
          ? [measure(a, moved), measure(moved, b)]
          : order === 'before'
            ? [measure(moved, a), measure(a, b)]
            : [measure(a, b), measure(b, moved)]
      if (measurements.some((m) => m.distance <= 0)) return
      result.push({ delta: position - bounds[axis], measurements })
    }
    if (gap > bounds[size])
      offer((a[axis] + a[size] + b[axis] - bounds[size]) / 2, 'between')
    offer(a[axis] - gap - bounds[size], 'before')
    offer(b[axis] + b[size] + gap, 'after')
  }
  return result
}

/** All comparisons are in document coordinates; tolerance is in CSS screen pixels. */
export function smartSnapBounds(
  bounds: Rect,
  scene: SmartSnapScene,
  options: SmartSnapOptions,
): SmartSnapResult {
  const empty: SmartSnapResult = {
    x: 0,
    y: 0,
    vertical: null,
    horizontal: null,
    lines: [],
    measurements: [],
    lock: { x: null, y: null },
  }
  if (
    !validRect(bounds) ||
    !Number.isFinite(options.zoom) ||
    options.zoom <= 0 ||
    !Number.isFinite(options.tolerance) ||
    options.tolerance < 0 ||
    !Number.isFinite(options.width) ||
    !Number.isFinite(options.height)
  )
    return empty
  const tolerance = Math.min(40, options.tolerance) / options.zoom
  const xs = [
    0,
    options.width / 2,
    options.width,
    ...options.guidesX.filter(Number.isFinite),
  ]
  const ys = [
    0,
    options.height / 2,
    options.height,
    ...options.guidesY.filter(Number.isFinite),
  ]
  for (const r of scene.objects) {
    xs.push(...anchors(r, 'x'))
    ys.push(...anchors(r, 'y'))
  }
  const result: SmartSnapResult = {
    ...snapBounds(bounds, {
      tolerance: Math.min(40, options.tolerance),
      zoom: options.zoom,
      x: xs,
      y: ys,
      grid: Number.isFinite(options.grid) ? Math.max(0, options.grid) : 0,
    }),
    lines: [],
    measurements: [],
    lock: { x: null, y: null },
  }
  for (const axis of ['x', 'y'] as const) {
    if (options.axis && options.axis !== axis) {
      result[axis] = 0
      if (axis === 'x') result.vertical = null
      else result.horizontal = null
      continue
    }
    let best = axis === 'x' ? result.vertical : result.horizontal
    let distance = best === null ? Infinity : Math.abs(result[axis])
    const gaps = gapCandidates(
      bounds,
      axis === 'x' ? scene.byX : scene.byY,
      axis,
    )
    for (const candidate of gaps) {
      if (
        Math.abs(candidate.delta) <= tolerance &&
        Math.abs(candidate.delta) < distance - EPSILON
      ) {
        result[axis] = candidate.delta
        distance = Math.abs(candidate.delta)
        best = null
      }
    }
    // Retain a valid target through small pointer jitter. Release is still measured
    // from the unsnapped pointer position, so there is no accumulated drag lag.
    const previous = options.previous?.[axis]
    if (
      previous !== null &&
      previous !== undefined &&
      Number.isFinite(previous)
    ) {
      const delta = previous - bounds[axis]
      if (Math.abs(delta) <= tolerance * 1.5 + EPSILON) {
        const values = anchors(bounds, axis).map((value) => value + delta)
        const target = (axis === 'x' ? xs : ys).find((value) =>
          values.some((v) => Math.abs(v - value) < EPSILON),
        )
        const gridMatch =
          Number.isFinite(options.grid) &&
          options.grid > 0 &&
          values.some(
            (value) =>
              Math.abs(
                value - Math.round(value / options.grid) * options.grid,
              ) < EPSILON,
          )
        const gapMatch = gaps.some(
          (candidate) => Math.abs(candidate.delta - delta) < EPSILON,
        )
        if (target !== undefined || gridMatch || gapMatch) {
          result[axis] = delta
          distance = Math.abs(delta)
          best = target ?? null
        }
      }
    }
    if (distance !== Infinity) result.lock[axis] = bounds[axis] + result[axis]
    if (axis === 'x') result.vertical = best
    else result.horizontal = best
  }
  const moved = { ...bounds, x: bounds.x + result.x, y: bounds.y + result.y }
  const lines = new Map<string, AlignmentGuide>()
  const addLine = (
    axis: Axis,
    position: number,
    from: number,
    to: number,
    kind: AlignmentGuide['kind'],
  ): void => {
    const key = `${axis}:${position.toFixed(6)}`
    const previous = lines.get(key)
    if (previous) {
      from = Math.min(from, axis === 'x' ? previous.from.y : previous.from.x)
      to = Math.max(to, axis === 'x' ? previous.to.y : previous.to.x)
    }
    lines.set(key, {
      from: axis === 'x' ? { x: position, y: from } : { x: from, y: position },
      to: axis === 'x' ? { x: position, y: to } : { x: to, y: position },
      kind,
    })
  }
  for (const axis of ['x', 'y'] as const) {
    if (options.axis && options.axis !== axis) continue
    const cross = axis === 'x' ? 'y' : 'x',
      size = axis === 'x' ? 'height' : 'width'
    const values = anchors(moved, axis)
    const matches = (value: number): boolean =>
      values.some((v) => Math.abs(v - value) < EPSILON)
    for (const position of axis === 'x'
      ? [0, options.width / 2, options.width]
      : [0, options.height / 2, options.height]) {
      if (matches(position))
        addLine(
          axis,
          position,
          Math.min(0, moved[cross]),
          Math.max(
            axis === 'x' ? options.height : options.width,
            moved[cross] + moved[size],
          ),
          'canvas',
        )
    }
    for (const position of axis === 'x' ? options.guidesX : options.guidesY) {
      if (Number.isFinite(position) && matches(position))
        addLine(
          axis,
          position,
          0,
          axis === 'x' ? options.height : options.width,
          'custom',
        )
    }
    for (const r of scene.objects)
      anchors(r, axis).forEach((position, index) => {
        if (matches(position))
          addLine(
            axis,
            position,
            Math.min(moved[cross], r[cross]),
            Math.max(moved[cross] + moved[size], r[cross] + r[size]),
            index === 1 ? 'center' : 'edge',
          )
      })
    const equal = gapCandidates(
      moved,
      axis === 'x' ? scene.byX : scene.byY,
      axis,
    ).find((c) => Math.abs(c.delta) < EPSILON)
    if (equal) result.measurements.push(...equal.measurements)
  }
  result.lines = [...lines.values()]
  const distances = spacingMeasurements(
    moved,
    scene.objects,
    160 / options.zoom,
  )
  result.measurements.push(
    ...distances.filter(
      (m) =>
        !result.measurements.some(
          (e) =>
            Math.abs(e.from.x - m.from.x) < EPSILON &&
            Math.abs(e.from.y - m.from.y) < EPSILON &&
            Math.abs(e.to.x - m.to.x) < EPSILON &&
            Math.abs(e.to.y - m.to.y) < EPSILON,
        ),
    ),
  )
  return result
}
