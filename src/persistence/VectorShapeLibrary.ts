import type { VectorGeometry } from '../core/model/types'
import {
  geometryBounds,
  transformGeometryPath,
} from '../core/vector/PathGeometry'
import { validatePathSyntax } from '../core/vector/PathSyntax'
export interface ShapePreset {
  name: string
  d: string
}
export const DEFAULT_SHAPES: ShapePreset[] = [
  { name: 'Diamond', d: 'M.5 0L1 .5L.5 1L0 .5Z' },
  {
    name: 'Heart',
    d: 'M.5 1C.3 .8 0 .6 0 .3C0 0 .35 -.1 .5 .2C.65 -.1 1 0 1 .3C1 .6 .7 .8 .5 1Z',
  },
  { name: 'Chevron', d: 'M0 0L.5 0L1 .5L.5 1L0 1L.5 .5Z' },
]
const KEY = 'photolisa.vectorShapeLibrary'
export function loadShapeLibrary(): ShapePreset[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw || raw.length > 1_000_000) return [...DEFAULT_SHAPES]
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value) || value.length > 64) return [...DEFAULT_SHAPES]
    const valid = value.filter(
      (preset): preset is ShapePreset =>
        typeof preset === 'object' &&
        preset !== null &&
        'name' in preset &&
        typeof preset.name === 'string' &&
        preset.name.length <= 100 &&
        'd' in preset &&
        typeof preset.d === 'string',
    )
    valid.forEach((preset) => validatePathSyntax(preset.d))
    return [...DEFAULT_SHAPES, ...valid]
  } catch {
    return [...DEFAULT_SHAPES]
  }
}
export function saveShapePreset(
  presets: ShapePreset[],
  name: string,
  geometry: VectorGeometry,
): ShapePreset[] {
  if (presets.length >= 67) throw new Error('The custom shape library is full')
  const b = geometryBounds(geometry)
  if (b.width <= 0 || b.height <= 0)
    throw new Error('Custom shapes require nonzero width and height')
  const d = transformGeometryPath(geometry, [
    1 / b.width,
    0,
    0,
    1 / b.height,
    -b.x / b.width,
    -b.y / b.height,
  ])
  const result = [
    ...presets,
    { name: name.trim().slice(0, 100) || 'Custom shape', d },
  ]
  const data = JSON.stringify(result.slice(DEFAULT_SHAPES.length))
  if (data.length > 1_000_000)
    throw new Error('Custom shape library exceeds 1 MiB')
  localStorage.setItem(KEY, data)
  return result
}
