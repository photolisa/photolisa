import type { ShapeTool, ShapeBounds } from './ShapeTool'
export const ellipseTool: ShapeTool = { id: 'ellipse', label: 'Ellipse', geometry: (b: ShapeBounds) => ({ type: 'ellipse', cx: b.width / 2, cy: b.height / 2, rx: b.width / 2, ry: b.height / 2 }) }
