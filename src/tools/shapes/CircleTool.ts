import type { ShapeTool, ShapeBounds } from './ShapeTool'
export const circleTool: ShapeTool = { id: 'circle', label: 'Circle', geometry: (b: ShapeBounds) => ({ type: 'circle', cx: b.width / 2, cy: b.height / 2, r: Math.min(b.width, b.height) / 2 }) }
