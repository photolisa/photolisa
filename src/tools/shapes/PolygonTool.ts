import type { ShapeTool, ShapeBounds } from './ShapeTool'

export function polygonPoints(width: number, height: number, sides: number): number[] {
  const count = Number.isFinite(sides) ? Math.max(3, Math.min(32, Math.round(sides))) : 5
  const points: number[] = []
  for (let index = 0; index < count; index += 1) {
    const angle = -Math.PI / 2 + 2 * Math.PI * index / count
    points.push(width * (0.5 + 0.5 * Math.cos(angle)), height * (0.5 + 0.5 * Math.sin(angle)))
  }
  return points
}

export const polygonTool: ShapeTool = {
  id: 'polygon', label: 'Polygon',
  geometry: (bounds: ShapeBounds, _radius: number, sides = 5) => ({ type: 'polygon', points: polygonPoints(bounds.width, bounds.height, sides), parametric: { kind: 'polygon', sides: Math.max(3, Math.min(32, Math.round(sides))), innerRadius: .5 } }),
}
