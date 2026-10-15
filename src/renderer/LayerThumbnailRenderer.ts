import { applyImageCrop } from '../raster/ImageCrop'
import { booleanGroupResult } from '../core/vector/BooleanGroup'
import type { EditorDocument } from '../core/model/EditorDocument'
import type { BlendMode, Layer } from '../core/model/types'
import { rasterSources, type RasterSourceRegistry } from '../raster/RasterSourceRegistry'
import { applySvgMatrix, paintVector } from '../raster/VectorPainter'
import { paintTextLayer } from '../raster/TextPainter'

const THUMBNAIL_SIZE = 40

export class LayerThumbnailRenderer {
  constructor(private readonly sources: RasterSourceRegistry = rasterSources) {}

  render(canvas: HTMLCanvasElement, layer: Layer, editorDocument: EditorDocument): void {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2)
    canvas.width = THUMBNAIL_SIZE * dpr
    canvas.height = THUMBNAIL_SIZE * dpr
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawCheckerboard(context)
    const fit = Math.min(THUMBNAIL_SIZE / editorDocument.dimensions.width, THUMBNAIL_SIZE / editorDocument.dimensions.height)
    const offsetX = (THUMBNAIL_SIZE - editorDocument.dimensions.width * fit) / 2
    const offsetY = (THUMBNAIL_SIZE - editorDocument.dimensions.height * fit) / 2
    context.save()
    context.translate(offsetX, offsetY)
    context.scale(fit, fit)
    this.drawLayer(context, layer)
    context.restore()
  }

  private drawLayer(context: CanvasRenderingContext2D, layer: Layer): void {
    if (!layer.visible) return
    context.save()
    const { x, y, scaleX, scaleY, rotation } = layer.transform
    context.translate(x, y)
    context.rotate(rotation)
    context.scale(scaleX, scaleY)
    applySvgMatrix(context, layer.svgMatrix)
    context.globalAlpha *= layer.opacity
    context.globalCompositeOperation = toCompositeOperation(layer.blendMode)
    if (layer.kind === 'group' && layer.booleanOperation) paintVector(context, booleanGroupResult(layer))
    else if (layer.kind === 'group') {
      layer.children.forEach((child) => this.drawLayer(context, child))
    } else if (layer.kind === 'vector') paintVector(context, layer)
    else if (layer.kind === 'text') context.drawImage(paintTextLayer(layer), 0, 0)
    else if (layer.pixelSourceId) {
      const source = this.sources.get(layer.pixelSourceId)
      if (source) { applyImageCrop(context, layer); context.drawImage(source.image, 0, 0) }
    }
    context.restore()
  }
}

function drawCheckerboard(context: CanvasRenderingContext2D): void {
  context.fillStyle = '#e4e4e7'
  context.fillRect(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE)
  context.fillStyle = '#c4c4c8'
  const size = 5
  for (let y = 0; y < THUMBNAIL_SIZE; y += size) {
    for (let x = 0; x < THUMBNAIL_SIZE; x += size) {
      if ((x / size + y / size) % 2 === 0) context.fillRect(x, y, size, size)
    }
  }
}

function toCompositeOperation(blendMode: BlendMode): GlobalCompositeOperation {
  return blendMode === 'normal' ? 'source-over' : blendMode
}
