import { validatePathSyntax } from '../vector/PathSyntax'
import type { VectorGeometry, VectorStyle } from './types'

export function validateVectorGeometry(geometry: VectorGeometry): void {
  if (!geometry || typeof geometry !== 'object') throw new Error('Invalid vector geometry')
  switch (geometry.type) {
    case 'path':
      if (typeof geometry.d !== 'string' || geometry.d.length > 1_000_000 || /[^\d\s.,+\-eEaAcChHlLmMqQsStTvVzZ]/.test(geometry.d)) throw new Error('Invalid vector path')
      validatePathSyntax(geometry.d)
      break
    case 'polygon':
      if (geometry.parametric && (!['polygon', 'star'].includes(geometry.parametric.kind) || !Number.isInteger(geometry.parametric.sides) || geometry.parametric.sides < 3 || geometry.parametric.sides > 64 || !Number.isFinite(geometry.parametric.innerRadius) || geometry.parametric.innerRadius <= 0 || geometry.parametric.innerRadius >= 1)) throw new Error('Invalid parametric shape')
      if (!Array.isArray(geometry.points) || geometry.points.length < 6 || geometry.points.length % 2 || geometry.points.length > 100_000 || geometry.points.some((value) => !Number.isFinite(value) || Math.abs(value) > 1_000_000)) throw new Error('Invalid vector polygon')
      break
    case 'rect': case 'circle': case 'ellipse': case 'line':
      for (const [key, value] of Object.entries(geometry)) if (key !== 'type' && (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000)) throw new Error(`Invalid vector ${key}`)
      if (geometry.type === 'rect' && (geometry.width < 0 || geometry.height < 0 || geometry.rx < 0 || geometry.ry < 0)) throw new Error('Invalid rectangle size')
      if (geometry.type === 'circle' && geometry.r < 0) throw new Error('Invalid circle radius')
      if (geometry.type === 'ellipse' && (geometry.rx < 0 || geometry.ry < 0)) throw new Error('Invalid ellipse radius')
      break
    default: throw new Error('Unsupported vector geometry')
  }
}

export function validateVectorStyle(style: VectorStyle): void {
  if (!style || typeof style !== 'object') throw new Error('Invalid vector style')
  if (style.fillRule !== 'nonzero' && style.fillRule !== 'evenodd') throw new Error('Invalid vector fill rule')
  if (!Number.isFinite(style.strokeWidth) || style.strokeWidth < 0 || style.strokeWidth > 10_000) throw new Error('Invalid vector stroke width')
  if (style.strokeAlignment !== undefined && !['inside', 'center', 'outside'].includes(style.strokeAlignment)) throw new Error('Invalid stroke alignment')
  if (style.strokeCap !== undefined && !['round', 'square', 'butt'].includes(style.strokeCap)) throw new Error('Invalid stroke cap')
  if (style.strokeJoin !== undefined && !['miter', 'round', 'bevel'].includes(style.strokeJoin)) throw new Error('Invalid stroke join')
  if (style.strokeDash && (!Array.isArray(style.strokeDash) || style.strokeDash.length > 64 || style.strokeDash.some(n => !Number.isFinite(n) || n <= 0 || n > 10000))) throw new Error('Dash lengths must be positive and at most 10000')
  const gradient = style.fillGradient
  if (gradient) {
    if (!['linear', 'radial'].includes(gradient.type) || !Array.isArray(gradient.stops) || gradient.stops.length < 1 || gradient.stops.length > 64) throw new Error('Invalid gradient')
    if (gradient.units && !['objectBoundingBox', 'userSpaceOnUse'].includes(gradient.units)) throw new Error('Invalid gradient units')
    if (gradient.transform && (gradient.transform.length !== 6 || gradient.transform.some(n => !Number.isFinite(n) || Math.abs(n) > 1_000_000))) throw new Error('Invalid gradient transform')
    for (const p of [gradient.start, gradient.end, ...(gradient.focus ? [gradient.focus] : [])]) if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 1_000_000 || Math.abs(p.y) > 1_000_000) throw new Error('Invalid gradient position')
    for (const stop of gradient.stops) if (stop.opacity !== undefined && (!Number.isFinite(stop.opacity) || stop.opacity < 0 || stop.opacity > 1) || !Number.isFinite(stop.offset) || stop.offset < 0 || stop.offset > 1) throw new Error('Invalid gradient stop')
  }
  for (const color of [style.fill, style.stroke, ...(gradient?.stops.map(stop => stop.color) ?? [])]) {
    if (color !== null && (typeof color !== 'string' || !/^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|[a-z]+|rgba?\([\d.,%\s]+\)|hsla?\([\d.,%\s]+\))$/i.test(color))) throw new Error('Invalid vector color')
  }
  for (const opacity of [style.fillOpacity, style.strokeOpacity]) if (opacity !== undefined && (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)) throw new Error('Invalid vector paint opacity')
}
