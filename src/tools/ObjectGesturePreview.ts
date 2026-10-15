import type { AffineMatrix } from '../core/model/types'
import { clampImageOffset, resizeImageCrop } from '../core/transform/ImageCrop'
import {
  freeTransformDelta,
  resizeDelta,
  restoreTransform,
  rotationDelta,
  setLocalMatrix,
  skewDelta,
  snapBounds,
  worldBounds,
} from '../core/transform/ObjectTransform'
import {
  invertAffine,
  multiplyAffine,
  transformPoint,
  type Point,
} from '../core/geometry/LayerCoordinates'
import { rasterSources } from '../raster/RasterSourceRegistry'
import type { Drag } from './ObjectInteractionState'
interface PreviewOptions {
  zoom: number
  textResizeMode: 'box' | 'scale'
  snapping: {
    tolerance: number
    grid: number
    guidesX: number[]
    guidesY: number[]
  } | null
}
/** Applies transient document-model previews without emitting history or Vue updates. */
export function previewObjectGesture(
  drag: Drag,
  point: Point,
  event: Pick<PointerEvent, 'shiftKey' | 'altKey'>,
  dimensions: { width: number; height: number },
  options: PreviewOptions,
): { vertical: number | null; horizontal: number | null } | undefined {
  if (drag.action === 'radius') {
    const entry = drag.entries[0]!,
      geometry = drag.geometryBefore
    if (entry.layer.kind === 'vector' && geometry?.type === 'rect') {
      const p = transformPoint(invertAffine(entry.world), point),
        radius = Math.max(
          0,
          Math.min(geometry.width / 2, geometry.height / 2, p.x - geometry.x),
        )
      entry.layer.geometry = { ...geometry, rx: radius, ry: radius }
    }
    return
  }
  if (drag.action === 'crop-move' || drag.action === 'crop-resize') {
    const entry = drag.entries[0]!
    if (entry.layer.kind !== 'raster') return
    const source = entry.layer.pixelSourceId
      ? rasterSources.get(entry.layer.pixelSourceId)
      : null
    if (!source) return
    const before = entry.before.crop ?? {
      x: 0,
      y: 0,
      width: source.width,
      height: source.height,
      offsetX: 0,
      offsetY: 0,
    }
    const inverse = invertAffine(entry.world),
      local = transformPoint(inverse, point),
      start = transformPoint(inverse, drag.start)
    const nextCrop =
      drag.action === 'crop-resize'
        ? resizeImageCrop(
            before,
            drag.handle,
            local,
            { x: 0, y: 0, width: source.width, height: source.height },
            event.altKey,
            event.shiftKey,
          )
        : clampImageOffset(
            {
              ...before,
              offsetX: before.offsetX + local.x - start.x,
              offsetY: before.offsetY + local.y - start.y,
            },
            source.width,
            source.height,
          )
    if (
      !entry.before.crop &&
      JSON.stringify(nextCrop) === JSON.stringify(before)
    )
      delete entry.layer.crop
    else entry.layer.crop = nextCrop
    return
  }
  let delta: AffineMatrix
  let guides: { vertical: number | null; horizontal: number | null } | undefined
  if (drag.action === 'move') {
    let x = point.x - drag.start.x,
      y = point.y - drag.start.y
    if (event.shiftKey) {
      if (Math.abs(x) > Math.abs(y)) y = 0
      else x = 0
    }
    const b = worldBounds(drag.frame!)
    if (options.snapping) {
      const settings = options.snapping ?? {
        tolerance: 6,
        grid: 0,
        guidesX: [],
        guidesY: [],
      }
      const xs = [
          0,
          dimensions.width / 2,
          dimensions.width,
          ...settings.guidesX,
        ],
        ys = [0, dimensions.height / 2, dimensions.height, ...settings.guidesY]
      for (const r of drag.targets) {
        xs.push(r.x, r.x + r.width / 2, r.x + r.width)
        ys.push(r.y, r.y + r.height / 2, r.y + r.height)
      }
      const snap = snapBounds(
        { ...b, x: b.x + x, y: b.y + y },
        {
          tolerance: settings.tolerance,
          zoom: options.zoom,
          x: xs,
          y: ys,
          grid: settings.grid,
        },
      )
      if (!event.shiftKey || y === 0) x += snap.x
      if (!event.shiftKey || x === 0) y += snap.y
      guides = snap
    }
    delta = [1, 0, 0, 1, x, y]
  } else if (drag.action === 'rotate')
    delta = rotationDelta(
      drag.pivot,
      drag.start,
      point,
      event.shiftKey,
      Math.atan2(drag.frame!.matrix[1], drag.frame!.matrix[0]),
    )
  else if (drag.action === 'free')
    delta = freeTransformDelta(drag.frame!, drag.handle, drag.start, point)
  else if (drag.action === 'skew')
    delta = skewDelta(drag.frame!, drag.handle, drag.start, point)
  else {
    // A group cannot shrink its smallest member below one document pixel.
    const ratio = Math.max(
      ...drag.entries.map(
        (e) =>
          1 /
          Math.max(
            1e-8,
            Math.min(
              e.bounds.width * Math.hypot(e.world[0], e.world[1]),
              e.bounds.height * Math.hypot(e.world[2], e.world[3]),
            ),
          ),
      ),
    )
    const minimum =
      drag.entries.length > 1
        ? {
            x: drag.frame!.bounds.width * ratio,
            y: drag.frame!.bounds.height * ratio,
          }
        : 1
    delta = resizeDelta(
      drag.frame!,
      drag.handle,
      point,
      event.altKey,
      event.shiftKey ||
        drag.entries.some((e) => e.layer.aspectRatioLocked === true),
      minimum,
    )
  }
  for (const entry of drag.entries) {
    if (drag.action === 'move') {
      restoreTransform(entry.layer, entry.before)
      const inverse = invertAffine(entry.parent),
        a = transformPoint(inverse, { x: 0, y: 0 }),
        b = transformPoint(inverse, { x: delta[4], y: delta[5] })
      entry.layer.transform.x += b.x - a.x
      entry.layer.transform.y += b.y - a.y
    } else if (
      drag.action === 'resize' &&
      drag.entries.length === 1 &&
      entry.layer.kind === 'text' &&
      options.textResizeMode === 'box'
    ) {
      // Change layout dimensions while retaining the original glyph scale and orientation.
      const transformed = multiplyAffine(delta, entry.world),
        original = entry.world
      const sx =
          Math.hypot(transformed[0], transformed[1]) /
          Math.hypot(original[0], original[1]),
        sy =
          Math.hypot(transformed[2], transformed[3]) /
          Math.hypot(original[2], original[3])
      const width = Math.max(1, Math.min(16384, entry.bounds.width * sx)),
        height = Math.max(1, Math.min(16384, entry.bounds.height * sy))
      if (width * height > 67108864) return
      entry.layer.textBox = { width, height }
      setLocalMatrix(
        entry.layer,
        multiplyAffine(
          invertAffine(entry.parent),
          multiplyAffine(transformed, [1 / sx, 0, 0, 1 / sy, 0, 0]),
        ),
      )
    } else
      setLocalMatrix(
        entry.layer,
        multiplyAffine(
          invertAffine(entry.parent),
          multiplyAffine(delta, entry.world),
        ),
      )
  }
  return guides
}
