import type { ShapeTool, ShapeBounds } from './ShapeTool'
export const rectangleTool: ShapeTool = { id: 'rectangle', label: 'Rectangle', geometry: (b: ShapeBounds) => ({ type: 'rect', x: 0, y: 0, width: b.width, height: b.height, rx: 0, ry: 0 }) }
