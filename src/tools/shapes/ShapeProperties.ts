import { geometryBounds, transformGeometryPath } from '../../core/vector/PathGeometry'
import type { VectorGeometry } from '../../core/model/types'

export function shapeSize(geometry: VectorGeometry): { width: number; height: number } | null {
  switch (geometry.type) {
    case 'rect': return { width: geometry.width, height: geometry.height }
    case 'circle': return { width: geometry.r * 2, height: geometry.r * 2 }
    case 'ellipse': return { width: geometry.rx * 2, height: geometry.ry * 2 }
    case 'polygon': {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (let i = 0; i < geometry.points.length; i += 2) {
        const x = geometry.points[i] ?? 0, y = geometry.points[i + 1] ?? 0
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
      }
      return { width: maxX - minX, height: maxY - minY }
    }
    case 'path': case 'line': return geometryBounds(geometry)
  }
}

export function resizeShape(geometry: VectorGeometry, dimension: 'width' | 'height', value: number): VectorGeometry {
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) throw new Error('Shape dimensions must be positive and no larger than 1,000,000 px.')
  switch (geometry.type) {
    case 'rect': return { ...geometry, [dimension]: value, rx: Math.min(geometry.rx, dimension === 'width' ? value / 2 : geometry.width / 2), ry: Math.min(geometry.ry, dimension === 'height' ? value / 2 : geometry.height / 2) }
    case 'circle': return { ...geometry, cx: geometry.cx - geometry.r + value / 2, cy: geometry.cy - geometry.r + value / 2, r: value / 2 }
    case 'ellipse': return dimension === 'width'
      ? { ...geometry, cx: geometry.cx - geometry.rx + value / 2, rx: value / 2 }
      : { ...geometry, cy: geometry.cy - geometry.ry + value / 2, ry: value / 2 }
    case 'polygon': {
      const size = shapeSize(geometry)
      if (!size) return geometry
      const old = size[dimension]
      if (old <= 0) throw new Error('Cannot resize a zero-size polygon')
      const values = geometry.points.filter((_, i) => i % 2 === (dimension === 'width' ? 0 : 1))
      const origin = values.reduce((minimum, point) => Math.min(minimum, point), Infinity)
      return { ...geometry, points: geometry.points.map((point, index) => (index % 2 === (dimension === 'width' ? 0 : 1) ? origin + (point - origin) * value / old : point)) }
    }
    case 'line': {
      const sign = dimension === 'width' ? Math.sign(geometry.x2 - geometry.x1) || 1 : Math.sign(geometry.y2 - geometry.y1) || 1
      return dimension === 'width' ? { ...geometry, x2: geometry.x1 + sign * value } : { ...geometry, y2: geometry.y1 + sign * value }
    }
    case 'path': {
      const b = geometryBounds(geometry), old = b[dimension]
      if (old <= 0) throw new Error('Cannot scale a zero-size path dimension')
      const sx = dimension === 'width' ? value / old : 1, sy = dimension === 'height' ? value / old : 1
      return { type: 'path', d: transformGeometryPath(geometry, [sx, 0, 0, sy, b.x * (1 - sx), b.y * (1 - sy)]) }
    }
  }
}
