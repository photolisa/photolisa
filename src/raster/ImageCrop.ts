import type { RasterLayer } from '../core/model/types'
/** Apply the same non-destructive image frame to exports, thumbnails and PSD previews. */
export function applyImageCrop(
  context: CanvasRenderingContext2D,
  layer: RasterLayer,
): void {
  const crop = layer.crop
  if (!crop) return
  context.beginPath()
  context.rect(crop.x, crop.y, crop.width, crop.height)
  context.clip()
  context.translate(crop.offsetX, crop.offsetY)
}
