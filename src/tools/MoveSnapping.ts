import { geometryBounds } from '../core/vector/PathGeometry'
import type { AffineMatrix, Layer, LayerTransform } from '../core/model/types'
import {
  IDENTITY_MATRIX,
  invertAffine,
  layerLocalMatrix,
  multiplyAffine,
  transformPoint,
} from '../core/geometry/LayerCoordinates'
import { rasterSources } from '../raster/RasterSourceRegistry'
import { textPixelSize } from '../raster/TextPainter'

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}
export interface SnapResult {
  transform: LayerTransform
  vertical: number | null
  horizontal: number | null
}

/** Snap a proposed layer position to canvas edges and centers in document coordinates. */
export function snapMove(
  layers: readonly Layer[],
  layer: Layer,
  canvasWidth: number,
  canvasHeight: number,
  zoom: number,
  excludeIds: readonly string[] = [],
): SnapResult {
  const unchanged = (): SnapResult => ({
    transform: { ...layer.transform },
    vertical: null,
    horizontal: null,
  })
  const parent = parentMatrix(layers, layer.id)
  let bounds: Bounds | null
  try {
    bounds = layerBounds(layer)
  } catch {
    return unchanged()
  }
  if (!parent || !bounds || bounds.width <= 0 || bounds.height <= 0)
    return unchanged()
  let inverseParent: AffineMatrix
  try {
    inverseParent = invertAffine(parent)
  } catch {
    return unchanged()
  }
  const matrix = multiplyAffine(parent, layerLocalMatrix(layer))
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ].map((point) => transformPoint(matrix, point))
  const xs = corners.map((point) => point.x),
    ys = corners.map((point) => point.y)
  const left = Math.min(...xs),
    right = Math.max(...xs),
    top = Math.min(...ys),
    bottom = Math.max(...ys)
  const threshold = 10 / Math.max(zoom, 0.01)
  const targetsX = [0, canvasWidth / 2, canvasWidth],
    targetsY = [0, canvasHeight / 2, canvasHeight]
  const excluded = new Set([layer.id, ...excludeIds])
  const collect = (
    tree: readonly Layer[],
    parentMatrix: AffineMatrix,
  ): void => {
    for (const other of tree) {
      if (!other.visible || excluded.has(other.id)) continue
      const world = multiplyAffine(parentMatrix, layerLocalMatrix(other))
      if (other.kind === 'group') {
        collect(other.children, world)
        continue
      }
      const b = layerBounds(other)
      if (!b) continue
      const points = [
        { x: b.x, y: b.y },
        { x: b.x + b.width, y: b.y },
        { x: b.x, y: b.y + b.height },
        { x: b.x + b.width, y: b.y + b.height },
      ].map((p) => transformPoint(world, p))
      const xs = points.map((p) => p.x),
        ys = points.map((p) => p.y),
        left = Math.min(...xs),
        right = Math.max(...xs),
        top = Math.min(...ys),
        bottom = Math.max(...ys)
      targetsX.push(left, (left + right) / 2, right)
      targetsY.push(top, (top + bottom) / 2, bottom)
    }
  }
  collect(layers, IDENTITY_MATRIX)
  const x = nearestSnap([left, (left + right) / 2, right], targetsX, threshold)
  const y = nearestSnap([top, (top + bottom) / 2, bottom], targetsY, threshold)
  const worldDelta = { x: x?.delta ?? 0, y: y?.delta ?? 0 }
  const origin = transformPoint(inverseParent, { x: 0, y: 0 })
  const localDelta = transformPoint(inverseParent, worldDelta)
  return {
    transform: {
      ...layer.transform,
      x: layer.transform.x + localDelta.x - origin.x,
      y: layer.transform.y + localDelta.y - origin.y,
    },
    vertical: x?.guide ?? null,
    horizontal: y?.guide ?? null,
  }
}

function nearestSnap(
  values: readonly number[],
  targets: readonly number[],
  threshold: number,
): { delta: number; guide: number } | null {
  let result: { delta: number; guide: number } | null = null
  for (const value of values)
    for (const target of targets) {
      const delta = target - value
      if (
        Math.abs(delta) <= threshold &&
        (!result || Math.abs(delta) < Math.abs(result.delta))
      )
        result = { delta, guide: target }
    }
  return result
}

function parentMatrix(
  layers: readonly Layer[],
  id: string,
  parent: AffineMatrix = IDENTITY_MATRIX,
): AffineMatrix | null {
  for (const layer of layers) {
    if (layer.id === id) return parent
    if (layer.kind === 'group') {
      const found = parentMatrix(
        layer.children,
        id,
        multiplyAffine(parent, layerLocalMatrix(layer)),
      )
      if (found) return found
    }
  }
  return null
}

function layerBounds(layer: Layer): Bounds | null {
  if (layer.kind === 'raster') {
    if (layer.crop) return { ...layer.crop }
    const source = layer.pixelSourceId
      ? rasterSources.get(layer.pixelSourceId)
      : null
    return source
      ? { x: 0, y: 0, width: source.width, height: source.height }
      : null
  }
  if (layer.kind === 'text') return { x: 0, y: 0, ...textPixelSize(layer) }
  if (layer.kind === 'vector') return geometryBounds(layer.geometry)
  return null
}
