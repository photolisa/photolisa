import { geometryPath } from '../core/vector/PathGeometry'
import { booleanGroupResult } from '../core/vector/BooleanGroup'
import type { AffineMatrix, Layer, VectorGeometry } from '../core/model/types'
import { IDENTITY_MATRIX, invertAffine, layerLocalMatrix, multiplyAffine, transformPoint, type Point } from '../core/geometry/LayerCoordinates'
import { rasterSources } from '../raster/RasterSourceRegistry'
import { textPixelSize } from '../raster/TextPainter'

/** Tests visible layer geometry in paint order without reading GPU pixels. */
export function layerAtPoint(layers: readonly Layer[], point: Point, zoom: number, parent: AffineMatrix = IDENTITY_MATRIX, skipIds: ReadonlySet<string> = new Set()): Layer | null {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index]!
    if (skipIds.has(layer.id) || !layer.visible || layer.locked || layer.opacity <= 0) continue
    const world = multiplyAffine(parent, layerLocalMatrix(layer))
    if (layer.kind === 'group' && layer.booleanOperation) {
      try { const local = transformPoint(invertAffine(world), point); const result = booleanGroupResult(layer); if (hitVector(result.geometry, local, result.style.strokeWidth, zoom, result.style.fillRule, !!result.style.fill || !!result.style.fillGradient)) return layer } catch { continue }
      continue
    }
    if (layer.kind === 'group') {
      const child = layerAtPoint(layer.children, point, zoom, world, skipIds)
      if (child) return child
      continue
    }
    let local: Point
    try { local = transformPoint(invertAffine(world), point) } catch { continue }
    if (layer.kind === 'raster') {
      const source = layer.pixelSourceId ? rasterSources.get(layer.pixelSourceId) : null
      if (source && (layer.crop ? inRect(local, layer.crop.x, layer.crop.y, layer.crop.width, layer.crop.height) : inRect(local, 0, 0, source.width, source.height))) return layer
    } else if (layer.kind === 'text') {
      try {
        const size = textPixelSize(layer)
        if (inRect(local, 0, 0, size.width, size.height)) return layer
      } catch { continue }
    } else if (hitVector(layer.geometry, local, layer.style.stroke ? layer.style.strokeWidth : 0, zoom * Math.max(.001, Math.min(Math.hypot(world[0], world[1]), Math.hypot(world[2], world[3]))), layer.style.fillRule, !!layer.style.fill || !!layer.style.fillGradient)) return layer
  }
  return null
}

function hitVector(geometry: VectorGeometry, point: Point, strokeWidth: number, zoom: number, fillRule: 'nonzero' | 'evenodd' = 'nonzero', hasFill = true): boolean {
  const margin = Math.max(strokeWidth / 2, 3 / Math.max(zoom, 0.01))
  const path = geometryPath(geometry)
  try {
    path.fillRule = fillRule
    if (hasFill && geometry.type !== 'line' && path.contains(point)) return true
    const nearest = path.getNearestPoint(point)
    return !!nearest && Math.hypot(nearest.x - point.x, nearest.y - point.y) <= margin
  } finally { path.remove() }
}

function inRect(point: Point, x: number, y: number, width: number, height: number): boolean {
  return point.x >= x && point.y >= y && point.x <= x + width && point.y <= y + height
}

/** Ordered overlap candidates; allows selection cycling without changing paint order. */
export function layersAtPoint(layers: readonly Layer[], point: Point, zoom: number): Layer[] {
  const skipped = new Set<string>(), hits: Layer[] = []
  while (hits.length < 256) { const hit = layerAtPoint(layers, point, zoom, IDENTITY_MATRIX, skipped); if (!hit) break; hits.push(hit); skipped.add(hit.id) }
  return hits
}
