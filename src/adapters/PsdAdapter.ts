import { applyImageCrop } from '../raster/ImageCrop'
import { readPsd, writePsdUint8Array, type Layer as PsdLayer, type PixelData, type Psd } from 'ag-psd'
import { EditorDocument, createEntityId } from '../core/model/EditorDocument'
import { createLayerBase, type BlendMode, type Layer } from '../core/model/types'
import { filterRegistry } from '../core/filters/FilterRegistry'
import { rasterSources, type RasterSourceRegistry } from '../raster/RasterSourceRegistry'
import { ImageExportAdapter } from './ImageExportAdapter'
import { FILE_LIMITS, validateFileSize, validateRasterBudget } from './FileSafety'
import { applySvgMatrix, paintVector } from '../raster/VectorPainter'
import { loadTextFont, paintTextLayer } from '../raster/TextPainter'
import { maskAlphaCanvas } from '../raster/MaskPixels'

export interface CompatibilityResult<T> { value: T; warnings: string[] }

export class PsdAdapter {
  constructor(private readonly sources: RasterSourceRegistry = rasterSources) {}

  async import(file: Blob, name = 'Imported PSD'): Promise<CompatibilityResult<EditorDocument>> {
    validateFileSize(file, 'PSD')
    const buffer = await file.arrayBuffer()
    const header = preflightPsd(buffer)
    const safeOptions = { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true, skipLinkedFilesData: true, totalMemoryLimit: FILE_LIMITS.maxDecodedBytes, useImageData: true } as const
    let structure: Psd
    try { structure = readPsd(buffer, safeOptions) } catch (error) { throw new Error(`PSD structure could not be read: ${errorMessage(error)}`, { cause: error }) }
    validateStructure(structure)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    let psd: Psd
    try { psd = readPsd(buffer, { skipCompositeImageData: true, skipThumbnail: true, skipLinkedFilesData: true, totalMemoryLimit: FILE_LIMITS.maxDecodedBytes, useImageData: true }) }
    catch (error) { throw new Error(`PSD pixel data could not be decoded safely: ${errorMessage(error)}`, { cause: error }) }
    const warnings = analyzePsd(psd)
    const registered: string[] = []
    try {
      const layers = importLayers(psd.children ?? [], this.sources, registered, warnings)
      const now = new Date().toISOString()
      const document = EditorDocument.deserialize({
        version: 2, id: createEntityId(), name: name.replace(/\.psd$/i, '') || 'Imported PSD',
        dimensions: { width: header.width, height: header.height, resolution: 72 }, background: 'transparent',
        layers, selectedLayerIds: layers[0] ? [layers[0].id] : [], activeLayerId: layers[0]?.id ?? null, revision: 0,
        metadata: { createdAt: now, modifiedAt: now, sourceFormat: 'psd', compatibilityWarnings: warnings },
      })
      return { value: document, warnings }
    } catch (error) { registered.forEach((id) => this.sources.remove(id)); throw error }
  }

  async export(document: EditorDocument): Promise<CompatibilityResult<Blob>> {
    validateRasterBudget(document.dimensions.width, document.dimensions.height, 'Document')
    const warnings: string[] = []
    const imageExporter = new ImageExportAdapter(this.sources)
    const temporary: string[] = []
    let psd: Psd
    try {
      const composite = (await imageExporter.renderDocument(document)).readPixels()
      await loadLayerFonts(document.layers)
      const layers = await bakeEffectGroups(document.layers, document.dimensions.width, document.dimensions.height, imageExporter, this.sources, temporary, warnings)
      psd = {
        width: document.dimensions.width, height: document.dimensions.height,
        imageData: toPixelData(composite),
        children: exportLayers(layers, document.dimensions.width, document.dimensions.height, this.sources, warnings),
      }
    } finally { imageExporter.destroy(); temporary.forEach(id => this.sources.remove(id)) }
    let bytes: Uint8Array
    try { bytes = writePsdUint8Array(psd, { generateThumbnail: false, invalidateTextLayers: false, logMissingFeatures: false }) }
    catch (error) { throw new Error(`PSD export failed: ${errorMessage(error)}`, { cause: error }) }
    return { value: new Blob([bytes as BlobPart], { type: 'image/vnd.adobe.photoshop' }), warnings: unique(warnings) }
  }
}

export function preflightPsd(input: ArrayBuffer): { width: number; height: number; channels: number } {
  if (input.byteLength < 26) throw new Error('PSD header is truncated')
  const bytes = new Uint8Array(input, 0, 26)
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== '8BPS') throw new Error('Not a Photoshop PSD file')
  const view = new DataView(input, 0, 26)
  const version = view.getUint16(4, false)
  if (version !== 1) throw new Error(version === 2 ? 'PSB large-document files are not supported' : `Unsupported PSD version: ${version}`)
  const channels = view.getUint16(12, false), height = view.getUint32(14, false), width = view.getUint32(18, false)
  const depth = view.getUint16(22, false), colorMode = view.getUint16(24, false)
  validateRasterBudget(width, height, 'PSD')
  if (channels < 1 || channels > 24) throw new Error('PSD channel count is unsafe or invalid')
  if (depth !== 8) throw new Error(`PSD ${depth}-bit channels are not supported; only 8-bit PSDs are accepted`)
  if (colorMode !== 1 && colorMode !== 3) throw new Error('Only RGB and grayscale PSD color modes are supported')
  if (width * height * channels > FILE_LIMITS.maxDecodedBytes) throw new Error('PSD declared channel memory exceeds the safety limit')
  return { width, height, channels }
}

function validateStructure(psd: Psd): void {
  let count = 0, pixels = psd.width * psd.height
  const visit = (layers: readonly PsdLayer[]): void => { for (const layer of layers) {
    if (++count > FILE_LIMITS.maxLayers) throw new Error('PSD contains too many layers')
    const width = Math.max(0, (layer.right ?? 0) - (layer.left ?? 0)), height = Math.max(0, (layer.bottom ?? 0) - (layer.top ?? 0))
    pixels += width * height
    if (!Number.isSafeInteger(pixels) || pixels * 4 > FILE_LIMITS.maxDecodedBytes) throw new Error('PSD decoded layer memory exceeds the safety limit')
    if (layer.children) visit(layer.children)
  } }
  visit(psd.children ?? [])
}

function importLayers(input: readonly PsdLayer[], sources: RasterSourceRegistry, registered: string[], warnings: string[]): Layer[] {
  return [...input].reverse().map((layer): Layer => {
    const base = { ...createLayerBase(createEntityId(), layer.children ? 'group' : 'raster', layer.name?.trim() || 'Untitled Layer'), visible: !layer.hidden, opacity: layer.opacity ?? 1, blendMode: importBlend(layer.blendMode, warnings), transform: { x: layer.left ?? 0, y: layer.top ?? 0, scaleX: 1, scaleY: 1, rotation: 0 } }
    if (layer.children) return { ...base, kind: 'group', children: importLayers(layer.children, sources, registered, warnings) }
    let pixelSourceId: string | null = null
    if (layer.imageData) { pixelSourceId = registerPixels(layer.imageData, sources); registered.push(pixelSourceId) }
    let mask = null
    if (layer.mask?.imageData && layer.imageData) {
      const id = registerPositionedMask(layer, sources, warnings)
      registered.push(id); mask = { pixelSourceId: id, enabled: !layer.mask.disabled, inverted: false }
    } else if (layer.mask) warnings.push(`Mask on “${layer.name ?? 'Untitled'}” could not be imported because its pixels or layer pixels are unavailable.`)
    return { ...base, kind: 'raster', pixelSourceId, mask }
  })
}

function exportLayers(input: readonly Layer[], width: number, height: number, sources: RasterSourceRegistry, warnings: string[]): PsdLayer[] {
  return [...input].reverse().map((layer): PsdLayer => {
    const common: PsdLayer = { name: layer.name, hidden: !layer.visible, opacity: layer.opacity, blendMode: layer.blendMode }
    if (layer.kind === 'group') {
      if (!isIdentity(layer.transform) || layer.svgMatrix) warnings.push(`Group “${layer.name}” transform cannot remain editable in PSD and was not preserved.`)
      if (layer.adjustments.some((a) => a.enabled)) warnings.push(`Group “${layer.name}” adjustments are not representable as Photolisa adjustments in PSD.`)
      common.children = exportLayers(layer.children, width, height, sources, warnings); common.opened = true; return common
    }
    if (layer.kind === 'vector') {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
      const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('2D canvas unavailable')
      context.translate(layer.transform.x, layer.transform.y); context.rotate(layer.transform.rotation)
      context.scale(layer.transform.scaleX, layer.transform.scaleY); applySvgMatrix(context, layer.svgMatrix)
      paintVector(context, layer)
      common.left = 0; common.top = 0; common.right = width; common.bottom = height
      common.imageData = toPixelData(context.getImageData(0, 0, width, height))
      warnings.push(`Vector layer “${layer.name}” was rasterized for PSD export.`)
      return common
    }
    if (layer.kind === 'text') {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
      const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('2D canvas unavailable')
      context.translate(layer.transform.x, layer.transform.y); context.rotate(layer.transform.rotation)
      context.scale(layer.transform.scaleX, layer.transform.scaleY); applySvgMatrix(context, layer.svgMatrix)
      context.drawImage(paintTextLayer(layer), 0, 0)
      common.left = 0; common.top = 0; common.right = width; common.bottom = height
      common.imageData = toPixelData(context.getImageData(0, 0, width, height))
      warnings.push(`Text layer “${layer.name}” was rasterized for PSD export; editability was lost.`)
      return common
    }
    const source = layer.pixelSourceId ? sources.get(layer.pixelSourceId) : undefined
    if (!source) return common
    const requiresBake = !!layer.crop || layer.transform.scaleX !== 1 || layer.transform.scaleY !== 1 || layer.transform.rotation !== 0 || !!layer.svgMatrix
    const enabled = layer.adjustments.filter((item) => item.enabled)
    let pixels = readSourcePixels(source.image, source.width, source.height)
    if (enabled.length) { pixels = new ImageData(filterRegistry.apply({ data: pixels.data, width: pixels.width, height: pixels.height }, enabled).data, source.width, source.height); warnings.push(`Adjustments on “${layer.name}” were baked into PSD pixels.`) }
    if (requiresBake) {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
      const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('2D canvas unavailable')
      const local = document.createElement('canvas'); local.width = source.width; local.height = source.height; local.getContext('2d')?.putImageData(pixels, 0, 0)
      context.translate(layer.transform.x, layer.transform.y); context.rotate(layer.transform.rotation); context.scale(layer.transform.scaleX, layer.transform.scaleY); applySvgMatrix(context, layer.svgMatrix); applyImageCrop(context, layer); context.drawImage(local, 0, 0)
      common.left = 0; common.top = 0; common.right = width; common.bottom = height; common.imageData = toPixelData(context.getImageData(0, 0, width, height))
      warnings.push(`Transform on “${layer.name}” was baked into PSD pixels.`)
    } else { common.left = layer.transform.x; common.top = layer.transform.y; common.right = layer.transform.x + source.width; common.bottom = layer.transform.y + source.height; common.imageData = toPixelData(pixels) }
    if (layer.mask) {
      const mask = sources.get(layer.mask.pixelSourceId)
      if (mask) {
        const alpha = maskAlphaCanvas(mask, layer.mask.inverted)
        let maskCanvas = alpha
        if (requiresBake) {
          maskCanvas = document.createElement('canvas'); maskCanvas.width = width; maskCanvas.height = height
          const maskContext = maskCanvas.getContext('2d'); if (!maskContext) throw new Error('2D canvas unavailable')
          maskContext.translate(layer.transform.x, layer.transform.y); maskContext.rotate(layer.transform.rotation)
          maskContext.scale(layer.transform.scaleX, layer.transform.scaleY); applySvgMatrix(maskContext, layer.svgMatrix)
          applyImageCrop(maskContext, layer)
          maskContext.drawImage(alpha, 0, 0)
        }
        const data = readSourcePixels(maskCanvas, maskCanvas.width, maskCanvas.height)
        for (let i = 0; i < data.data.length; i += 4) {
          const coverage = data.data[i + 3] ?? 0
          data.data[i] = coverage; data.data[i + 1] = coverage; data.data[i + 2] = coverage; data.data[i + 3] = 255
        }
        common.mask = { top: common.top, left: common.left, bottom: common.bottom, right: common.right,
          disabled: !layer.mask.enabled, imageData: toPixelData(data) }
      } else warnings.push(`Mask pixels on “${layer.name}” were unavailable for PSD export.`)
    }
    return common
  })
}

async function loadLayerFonts(layers: readonly Layer[]): Promise<void> {
  for (const layer of layers) {
    if (layer.kind === 'group') await loadLayerFonts(layer.children)
    else if (layer.kind === 'text') await loadTextFont(layer)
  }
}

function analyzePsd(psd: Psd): string[] {
  const warnings: string[] = []
  const visit = (layers: readonly PsdLayer[]): void => layers.forEach((layer) => {
    if (layer.text) warnings.push(`Text layer “${layer.name ?? 'Untitled'}” was imported from its raster preview; text editing is not preserved.`)
    if (layer.placedLayer) warnings.push(`Smart object “${layer.name ?? 'Untitled'}” was imported from its raster preview.`)
    if (layer.vectorMask || layer.vectorFill || layer.vectorStroke) warnings.push(`Vector content on “${layer.name ?? 'Untitled'}” was rasterized or omitted.`)
    if (layer.effects) warnings.push(`Layer effects on “${layer.name ?? 'Untitled'}” are not editable in Photolisa.`)
    if (layer.clipping) warnings.push(`Clipping on “${layer.name ?? 'Untitled'}” is not preserved accurately.`)
    if (layer.children) visit(layer.children)
  })
  visit(psd.children ?? [])
  if (psd.linkedFiles?.length) warnings.push('Embedded or linked smart-object source files were intentionally not decoded for safety.')
  return unique(warnings)
}

function registerPixels(pixels: PixelData, sources: RasterSourceRegistry): string {
  validateRasterBudget(pixels.width, pixels.height, 'PSD layer')
  const canvas = document.createElement('canvas'); canvas.width = pixels.width; canvas.height = pixels.height
  const context = canvas.getContext('2d'); if (!context) throw new Error('2D canvas unavailable')
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0)
  return sources.registerCanvas(canvas)
}
function registerPositionedMask(layer: PsdLayer, sources: RasterSourceRegistry, warnings: string[]): string {
  const mask = layer.mask!
  const image = layer.imageData!
  const pixels = mask.imageData!
  validateRasterBudget(image.width, image.height, 'PSD mask')
  validateRasterBudget(pixels.width, pixels.height, 'PSD mask pixels')
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
  const context = canvas.getContext('2d'); if (!context) throw new Error('2D canvas unavailable')
  const background = mask.defaultColor ?? 255
  context.fillStyle = `rgb(${background},${background},${background})`
  context.fillRect(0, 0, canvas.width, canvas.height)
  const source = document.createElement('canvas'); source.width = pixels.width; source.height = pixels.height
  source.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0)
  const left = mask.positionRelativeToLayer ? (mask.left ?? 0) : (mask.left ?? layer.left ?? 0) - (layer.left ?? 0)
  const top = mask.positionRelativeToLayer ? (mask.top ?? 0) : (mask.top ?? layer.top ?? 0) - (layer.top ?? 0)
  context.drawImage(source, left, top)
  if (mask.userMaskDensity !== undefined || mask.userMaskFeather !== undefined || mask.vectorMaskDensity !== undefined || mask.vectorMaskFeather !== undefined)
    warnings.push(`Mask density or feather metadata on “${layer.name ?? 'Untitled'}” was not preserved.`)
  return sources.registerCanvas(canvas)
}
function readSourcePixels(image: CanvasImageSource, width: number, height: number): ImageData {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('2D canvas unavailable')
  context.drawImage(image, 0, 0); return context.getImageData(0, 0, width, height)
}
function toPixelData(image: ImageData): PixelData { return { data: image.data, width: image.width, height: image.height } }
function importBlend(mode: PsdLayer['blendMode'], warnings: string[]): BlendMode {
  if (!mode || mode === 'normal' || mode === 'multiply' || mode === 'screen' || mode === 'overlay') return mode ?? 'normal'
  warnings.push(`Blend mode “${mode}” is unsupported and was changed to normal.`); return 'normal'
}
function isIdentity(transform: Layer['transform']): boolean { return transform.x === 0 && transform.y === 0 && transform.scaleX === 1 && transform.scaleY === 1 && transform.rotation === 0 }
function unique(values: string[]): string[] { return [...new Set(values)] }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Unknown error' }

/** PSD cannot encode Photolisa effect stacks; bake effected groups instead of dropping them. */
async function bakeEffectGroups(layers: readonly Layer[], width: number, height: number, exporter: ImageExportAdapter, sources: RasterSourceRegistry, temporary: string[], warnings: string[]): Promise<Layer[]> {
  const result: Layer[] = []
  for (const layer of layers) {
    if (layer.kind === 'group' && layer.adjustments.some(effect => effect.enabled)) {
      const canvas = await exporter.renderEffectLayer(layer, width, height), id = sources.registerCanvas(canvas)
      temporary.push(id)
      result.push({ ...createLayerBase(layer.id, 'raster', layer.name), kind: 'raster', visible: layer.visible, locked: layer.locked, opacity: layer.opacity, blendMode: layer.blendMode, transform: { ...layer.transform }, ...(layer.svgMatrix ? { svgMatrix: [...layer.svgMatrix] } : {}), pixelSourceId: id })
      warnings.push(`Effects on group “${layer.name}” were baked into a raster layer for PSD; save a Photolisa project to keep the stack editable.`)
    } else if (layer.kind === 'group') result.push({ ...layer, children: await bakeEffectGroups(layer.children, width, height, exporter, sources, temporary, warnings) })
    else result.push(layer)
  }
  return result
}
