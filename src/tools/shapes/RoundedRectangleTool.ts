import type { ShapeTool, ShapeBounds } from './ShapeTool'
export const roundedRectangleTool: ShapeTool = { id: 'rounded-rectangle', label: 'Rounded rectangle', geometry: (b: ShapeBounds, radius: number) => ({ type: 'rect', x: 0, y: 0, width: b.width, height: b.height, rx: Math.min(radius, b.width / 2, b.height / 2), ry: Math.min(radius, b.width / 2, b.height / 2) }) }
