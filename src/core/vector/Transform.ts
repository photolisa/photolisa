import type { LayerTransform } from '../model/types'
import type { Bounds } from './PathGeometry'
import type { Point } from '../geometry/LayerCoordinates'
export const resizeHandles: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 0.5 },
  { x: 1, y: 1 },
  { x: 0.5, y: 1 },
  { x: 0, y: 1 },
  { x: 0, y: 0.5 },
]
export function rotated(point: Point, radians: number): Point {
  const c = Math.cos(radians),
    s = Math.sin(radians)
  return { x: point.x * c - point.y * s, y: point.x * s + point.y * c }
}
export function transformLocal(point: Point, transform: LayerTransform): Point {
  const p = rotated(
    { x: point.x * transform.scaleX, y: point.y * transform.scaleY },
    transform.rotation,
  )
  return { x: transform.x + p.x, y: transform.y + p.y }
}
export function resizeTransform(
  before: LayerTransform,
  bounds: Bounds,
  handle: Point,
  point: Point,
  fromCenter: boolean,
  constrain: boolean,
): LayerTransform {
  const pivot = {
    x: bounds.x + bounds.width * (fromCenter ? 0.5 : 1 - handle.x),
    y: bounds.y + bounds.height * (fromCenter ? 0.5 : 1 - handle.y),
  }
  const pivotParent = transformLocal(pivot, before),
    localVector = rotated(
      { x: point.x - pivotParent.x, y: point.y - pivotParent.y },
      -before.rotation,
    )
  const hx = bounds.x + bounds.width * handle.x - pivot.x,
    hy = bounds.y + bounds.height * handle.y - pivot.y
  let scaleX =
    handle.x === 0.5 || Math.abs(hx) < 1e-8 ? before.scaleX : localVector.x / hx
  let scaleY =
    handle.y === 0.5 || Math.abs(hy) < 1e-8 ? before.scaleY : localVector.y / hy
  if (constrain) {
    const ratio =
      handle.x === 0.5
        ? Math.abs(scaleY / before.scaleY)
        : handle.y === 0.5
          ? Math.abs(scaleX / before.scaleX)
          : Math.max(
              Math.abs(scaleX / before.scaleX),
              Math.abs(scaleY / before.scaleY),
            )
    scaleX =
      Math.sign(scaleX || before.scaleX) * Math.abs(before.scaleX) * ratio
    scaleY =
      Math.sign(scaleY || before.scaleY) * Math.abs(before.scaleY) * ratio
  }
  scaleX =
    Math.sign(scaleX || 1) * Math.max(0.001, Math.min(10000, Math.abs(scaleX)))
  scaleY =
    Math.sign(scaleY || 1) * Math.max(0.001, Math.min(10000, Math.abs(scaleY)))
  const offset = rotated(
    { x: pivot.x * scaleX, y: pivot.y * scaleY },
    before.rotation,
  )
  return {
    ...before,
    scaleX,
    scaleY,
    x: pivotParent.x - offset.x,
    y: pivotParent.y - offset.y,
  }
}
export function rotateTransform(
  before: LayerTransform,
  bounds: Bounds,
  rotation: number,
  origin: Point = { x: 0.5, y: 0.5 },
): LayerTransform {
  const pivot = {
      x: bounds.x + bounds.width * origin.x,
      y: bounds.y + bounds.height * origin.y,
    },
    pivotParent = transformLocal(pivot, before)
  const offset = rotated(
    { x: pivot.x * before.scaleX, y: pivot.y * before.scaleY },
    rotation,
  )
  return {
    ...before,
    rotation,
    x: pivotParent.x - offset.x,
    y: pivotParent.y - offset.y,
  }
}
