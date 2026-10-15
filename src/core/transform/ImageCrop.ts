import type { LayerImageCrop } from '../model/types'
import type { Point } from '../geometry/LayerCoordinates'
import type { Rect } from './ObjectTransform'
/** Keep the image covering its frame while allowing original pixels to be revealed later. */
export function clampImageOffset(
  crop: LayerImageCrop,
  width: number,
  height: number,
): LayerImageCrop {
  return {
    ...crop,
    offsetX: Math.max(
      crop.x + crop.width - width,
      Math.min(crop.x, crop.offsetX),
    ),
    offsetY: Math.max(
      crop.y + crop.height - height,
      Math.min(crop.y, crop.offsetY),
    ),
  }
}
export function resizeImageCrop(
  before: LayerImageCrop,
  handle: Point,
  point: Point,
  source: Rect,
  center: boolean,
  proportional: boolean,
): LayerImageCrop {
  const pivot = {
    x: before.x + before.width * (center ? 0.5 : 1 - handle.x),
    y: before.y + before.height * (center ? 0.5 : 1 - handle.y),
  }
  let width =
    handle.x === 0.5
      ? before.width
      : Math.max(
          1,
          (point.x - pivot.x) * (handle.x === 0 ? -1 : 1) * (center ? 2 : 1),
        )
  let height =
    handle.y === 0.5
      ? before.height
      : Math.max(
          1,
          (point.y - pivot.y) * (handle.y === 0 ? -1 : 1) * (center ? 2 : 1),
        )
  if (proportional) {
    const ratio =
      handle.x === 0.5 ? height / before.height : width / before.width
    width = Math.max(1, before.width * ratio)
    height = Math.max(1, before.height * ratio)
  }
  width = Math.min(source.width, width)
  height = Math.min(source.height, height)
  const x = center
    ? pivot.x - width / 2
    : handle.x === 0
      ? pivot.x - width
      : handle.x === 0.5 && proportional
        ? pivot.x - width / 2
        : before.x
  const y = center
    ? pivot.y - height / 2
    : handle.y === 0
      ? pivot.y - height
      : handle.y === 0.5 && proportional
        ? pivot.y - height / 2
        : before.y
  return clampImageOffset(
    {
      ...before,
      x: Math.max(0, Math.min(source.width - width, x)),
      y: Math.max(0, Math.min(source.height - height, y)),
      width,
      height,
    },
    source.width,
    source.height,
  )
}
