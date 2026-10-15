import type { ShapeTool } from './ShapeTool'
export function starPoints(width: number, height: number, points = 5, inner = .5): number[] {
  points = Math.max(3, Math.min(64, Math.round(points)))
  inner = Math.max(.01, Math.min(.99, inner))
  return Array.from({ length: points * 2 }, (_, i) => {
    const angle = i * Math.PI / points - Math.PI / 2, radius = i % 2 ? inner : 1
    return [width / 2 + Math.cos(angle) * width / 2 * radius, height / 2 + Math.sin(angle) * height / 2 * radius]
  }).flat()
}
export const triangleTool: ShapeTool = { id: 'triangle', label: 'Triangle', geometry: b => ({ type: 'polygon', points: [b.width / 2, 0, b.width, b.height, 0, b.height] }) }
export const starTool: ShapeTool = { id: 'star', label: 'Star', geometry: (b, _radius, points = 5, inner = .5) => ({ type: 'polygon', points: starPoints(b.width, b.height, points, inner), parametric: { kind: 'star', sides: Math.max(3, Math.min(64, Math.round(points))), innerRadius: Math.max(.01, Math.min(.99, inner)) } }) }
export const arrowTool: ShapeTool = { id: 'arrow', label: 'Arrow', geometry: b => ({ type: 'line', x1: 0, y1: 0, x2: b.width, y2: b.height }) }
export const customShapeTool: ShapeTool = { id: 'custom-shape', label: 'Diamond', geometry: b => ({ type: 'polygon', points: [b.width / 2, 0, b.width, b.height / 2, b.width / 2, b.height, 0, b.height / 2] }) }
