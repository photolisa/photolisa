import type { VectorGeometry } from '../../core/model/types'

export interface ShapeBounds { x: number; y: number; width: number; height: number }
export interface ShapePoint { x: number; y: number }
export interface ShapeTool {
  readonly id: string
  readonly label: string
  geometry(bounds: ShapeBounds, cornerRadius: number, sides?: number, innerRadius?: number): VectorGeometry
}

/** Modifier interpretation is shared by preview and commit, in document pixels. */
export function shapeBounds(start: ShapePoint, end: ShapePoint, fromCenter: boolean, constrain: boolean): ShapeBounds {
  let dx = end.x - start.x
  let dy = end.y - start.y
  if (constrain) {
    const side = Math.max(Math.abs(dx), Math.abs(dy))
    dx = Math.sign(dx || 1) * side
    dy = Math.sign(dy || 1) * side
  }
  const otherX = fromCenter ? start.x - dx : start.x
  const otherY = fromCenter ? start.y - dy : start.y
  return { x: Math.min(otherX, start.x + dx), y: Math.min(otherY, start.y + dy), width: Math.abs(start.x + dx - otherX), height: Math.abs(start.y + dy - otherY) }
}

export function lineEndpoints(start: ShapePoint, end: ShapePoint, fromCenter: boolean, constrain: boolean): { start: ShapePoint; end: ShapePoint } {
  let dx = end.x - start.x, dy = end.y - start.y
  if (constrain) { const length = Math.hypot(dx, dy), angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4; dx = Math.cos(angle) * length; dy = Math.sin(angle) * length }
  return { start: fromCenter ? { x: start.x - dx, y: start.y - dy } : start, end: { x: start.x + dx, y: start.y + dy } }
}
