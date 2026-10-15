import type {
  AffineMatrix,
  Layer,
  LayerTransform,
  LayerImageCrop,
} from '../model/types'
import {
  invertAffine,
  multiplyAffine,
  transformPoint,
  type Point,
} from '../geometry/LayerCoordinates'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export interface TransformFrame {
  bounds: Rect
  matrix: AffineMatrix
}
export interface TransformState {
  transform: LayerTransform
  matrix: AffineMatrix | null
  textBox: { width: number; height: number } | null
  crop: LayerImageCrop | null
}
export const HANDLES: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 0.5 },
  { x: 1, y: 1 },
  { x: 0.5, y: 1 },
  { x: 0, y: 1 },
  { x: 0, y: 0.5 },
]
export function captureTransform(layer: Layer): TransformState {
  return {
    transform: { ...layer.transform },
    matrix: layer.svgMatrix ? [...layer.svgMatrix] : null,
    textBox:
      layer.kind === 'text' && layer.textBox ? { ...layer.textBox } : null,
    crop: layer.kind === 'raster' && layer.crop ? { ...layer.crop } : null,
  }
}
export function restoreTransform(layer: Layer, state: TransformState): void {
  if (layer.kind === 'raster') {
    if (state.crop) layer.crop = { ...state.crop }
    else delete layer.crop
  }
  if (layer.kind === 'text') {
    if (state.textBox) layer.textBox = { ...state.textBox }
    else delete layer.textBox
  }
  layer.transform = { ...state.transform }
  if (state.matrix) layer.svgMatrix = [...state.matrix]
  else delete layer.svgMatrix
}
/** Decompose an affine result into inspectable position, rotation, scale and residual shear. */
export function setLocalMatrix(layer: Layer, matrix: AffineMatrix): void {
  const [a, b, c, d, x, y] = matrix
  if (!matrix.every(Number.isFinite)) throw new Error('Invalid transform')
  const scaleX = Math.hypot(a, b),
    det = a * d - b * c
  if (scaleX < 1e-8 || Math.abs(det) < 1e-10)
    throw new Error('Degenerate transform')
  const scaleY = det / scaleX,
    shear = (a * c + b * d) / (scaleX * scaleX)
  layer.transform = { x, y, scaleX, scaleY, rotation: Math.atan2(b, a) }
  if (Math.abs(shear) > 1e-10) layer.svgMatrix = [1, 0, shear, 1, 0, 0]
  else delete layer.svgMatrix
}
export function framePoints(frame: TransformFrame): Point[] {
  const b = frame.bounds
  return HANDLES.map((p) =>
    transformPoint(frame.matrix, {
      x: b.x + b.width * p.x,
      y: b.y + b.height * p.y,
    }),
  )
}
export function worldBounds(frame: TransformFrame): Rect {
  const points = framePoints(frame),
    xs = points.map((p) => p.x),
    ys = points.map((p) => p.y)
  const x = Math.min(...xs),
    y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}
export function unionBounds(bounds: readonly Rect[]): Rect {
  const x = Math.min(...bounds.map((b) => b.x)),
    y = Math.min(...bounds.map((b) => b.y))
  return {
    x,
    y,
    width: Math.max(...bounds.map((b) => b.x + b.width)) - x,
    height: Math.max(...bounds.map((b) => b.y + b.height)) - y,
  }
}
export function around(point: Point, linear: AffineMatrix): AffineMatrix {
  return multiplyAffine(
    [1, 0, 0, 1, point.x, point.y],
    multiplyAffine(linear, [1, 0, 0, 1, -point.x, -point.y]),
  )
}
export function rotationDelta(
  pivot: Point,
  start: Point,
  point: Point,
  snap: boolean,
  initialAngle = 0,
): AffineMatrix {
  let angle =
    Math.atan2(point.y - pivot.y, point.x - pivot.x) -
    Math.atan2(start.y - pivot.y, start.x - pivot.x)
  if (snap)
    angle =
      Math.round((angle + initialAngle) / (Math.PI / 12)) * (Math.PI / 12) -
      initialAngle
  return around(pivot, [
    Math.cos(angle),
    Math.sin(angle),
    -Math.sin(angle),
    Math.cos(angle),
    0,
    0,
  ])
}
/** Resizes in the object's original basis, including rotated and sheared parent transforms. */
export function resizeDelta(
  frame: TransformFrame,
  handle: Point,
  point: Point,
  center: boolean,
  proportional: boolean,
  minimum: number | Point = 1,
): AffineMatrix {
  const b = frame.bounds,
    local = transformPoint(invertAffine(frame.matrix), point)
  const pivot = {
    x: b.x + b.width * (center ? 0.5 : 1 - handle.x),
    y: b.y + b.height * (center ? 0.5 : 1 - handle.y),
  }
  const hx = b.width * (handle.x - (center ? 0.5 : 1 - handle.x)),
    hy = b.height * (handle.y - (center ? 0.5 : 1 - handle.y))
  const minX =
    (typeof minimum === 'number' ? minimum : minimum.x) /
    Math.max(1e-8, b.width * Math.hypot(frame.matrix[0], frame.matrix[1]))
  const minY =
    (typeof minimum === 'number' ? minimum : minimum.y) /
    Math.max(1e-8, b.height * Math.hypot(frame.matrix[2], frame.matrix[3]))
  let sx =
    handle.x === 0.5 || !hx ? 1 : Math.max(minX, (local.x - pivot.x) / hx)
  let sy =
    handle.y === 0.5 || !hy ? 1 : Math.max(minY, (local.y - pivot.y) / hy)
  if (proportional) {
    const ratio =
      handle.x === 0.5
        ? sy
        : handle.y === 0.5
          ? sx
          : Math.abs(sx - 1) > Math.abs(sy - 1)
            ? sx
            : sy
    sx = sy = Math.max(minX, minY, ratio)
  }
  return multiplyAffine(
    frame.matrix,
    multiplyAffine(
      around(pivot, [sx, 0, 0, sy, 0, 0]),
      invertAffine(frame.matrix),
    ),
  )
}
/** Edge shear and affine corner free transform preserve source data and invertibility. */
export function skewDelta(
  frame: TransformFrame,
  handle: Point,
  start: Point,
  point: Point,
): AffineMatrix {
  const inverse = invertAffine(frame.matrix),
    a = transformPoint(inverse, start),
    b = transformPoint(inverse, point)
  const bounds = frame.bounds,
    pivot = {
      x: bounds.x + bounds.width * (1 - handle.x),
      y: bounds.y + bounds.height * (1 - handle.y),
    }
  const horizontal = handle.y !== 0.5
  const shear = horizontal
    ? (b.x - a.x) / (bounds.height * (2 * handle.y - 1) || 1)
    : (b.y - a.y) / (bounds.width * (2 * handle.x - 1) || 1)
  return multiplyAffine(
    frame.matrix,
    multiplyAffine(
      around(
        pivot,
        horizontal ? [1, 0, shear, 1, 0, 0] : [1, shear, 0, 1, 0, 0],
      ),
      inverse,
    ),
  )
}

export interface SnapOptions {
  tolerance: number
  zoom: number
  x: readonly number[]
  y: readonly number[]
  grid?: number
}
export interface SnapDelta {
  x: number
  y: number
  vertical: number | null
  horizontal: number | null
}
export function snapBounds(bounds: Rect, options: SnapOptions): SnapDelta {
  const nearest = (
    values: number[],
    targets: readonly number[],
  ): { delta: number; guide: number } | null => {
    let best: { delta: number; guide: number } | null = null
    for (const value of values) {
      const candidates =
        options.grid && options.grid > 0
          ? [...targets, Math.round(value / options.grid) * options.grid]
          : targets
      for (const guide of candidates) {
        const delta = guide - value
        if (
          Math.abs(delta) <= options.tolerance / Math.max(0.01, options.zoom) &&
          (!best || Math.abs(delta) < Math.abs(best.delta))
        )
          best = { delta, guide }
      }
    }
    return best
  }
  const x = nearest(
    [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width],
    options.x,
  )
  const y = nearest(
    [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height],
    options.y,
  )
  return {
    x: x?.delta ?? 0,
    y: y?.delta ?? 0,
    vertical: x?.guide ?? null,
    horizontal: y?.guide ?? null,
  }
}

/** Affine free transform: opposite edge stays fixed; the dragged corner controls shear and scale. */
export function freeTransformDelta(
  frame: TransformFrame,
  handle: Point,
  start: Point,
  point: Point,
): AffineMatrix {
  const inverse = invertAffine(frame.matrix),
    a = transformPoint(inverse, start),
    b = transformPoint(inverse, point),
    bounds = frame.bounds
  const pivot = {
    x: bounds.x + bounds.width * handle.x,
    y: bounds.y + bounds.height * (1 - handle.y),
  }
  const span = Math.max(1e-8, bounds.height) * (2 * handle.y - 1)
  const scale = Math.max(
    1 /
      Math.max(
        1e-8,
        bounds.height * Math.hypot(frame.matrix[2], frame.matrix[3]),
      ),
    1 + (b.y - a.y) / span,
  )
  return multiplyAffine(
    frame.matrix,
    multiplyAffine(
      around(pivot, [1, 0, (b.x - a.x) / span, scale, 0, 0]),
      inverse,
    ),
  )
}
