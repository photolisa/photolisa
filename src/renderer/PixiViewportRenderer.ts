import { EffectPreviewCache } from './EffectPreviewCache'
import { layerWorldMatrix } from '../core/geometry/LayerCoordinates'
import { booleanGroupResult } from '../core/vector/BooleanGroup'
import { Application, Container, Graphics, Matrix, Rectangle, Texture, TilingSprite, type Filter } from 'pixi.js'
import type { EditorDocument } from '../core/model/EditorDocument'
import type { Layer } from '../core/model/types'
import { rasterSources, type RasterSourceRegistry } from '../raster/RasterSourceRegistry'
import { RulerOverlay } from './RulerOverlay'
import { Viewport, type ScreenPoint } from './Viewport'
import { createPixiFilter } from './filters/PixiFilterFactory'
import { RasterTextureCache } from './RasterTextureCache'
import { createVectorGraphics } from './VectorGraphics'
import { maskAlphaCanvas } from '../raster/MaskPixels'
import { paintTextLayer } from '../raster/TextPainter'

export interface ViewState {
  zoom: number
  origin: Readonly<ScreenPoint>
  center: Readonly<ScreenPoint>
}

export interface SampleRegion { pixels: Uint8ClampedArray; width: number; height: number; x: number; y: number }

export interface PixiViewportRendererOptions {
  workspaceBackground?: string
  sourceRegistry?: RasterSourceRegistry
  onViewChange?: (state: ViewState) => void
  onError?: (message: string) => void
}

export class PixiViewportRenderer {
  private readonly app = new Application()
  private readonly workspaceBackground: string
  private readonly documentRoot = new Container()
  private readonly viewport = new Viewport()
  private readonly sourceRegistry: RasterSourceRegistry
  private readonly onViewChange: ((state: ViewState) => void) | undefined
  private readonly onError: ((message: string) => void) | undefined
  private readonly effects: EffectPreviewCache
  private readonly textures: RasterTextureCache
  private readonly layerDisplays = new Map<string, Container>()
  private readonly layerFilters = new Map<string, Filter[]>()
  private readonly imageFrames = new Map<string, { content: Container; mask: Graphics; signature: string }>()
  private readonly filterSignatures = new Map<string, string>()
  private readonly groupCacheSignatures = new Map<string, string>()
  private readonly cachedGroups = new Map<string, Container>()
  private readonly sampleIsolationGroups = new Set<string>()
  private readonly sourceToCachedGroups = new Map<string, Set<string>>()
  private readonly maskedPreviewSources = new Set<string>()
  private cachedGroupBytes = 0
  private layerRoot: Container | null = null
  private host: HTMLElement | null = null
  private ruler: RulerOverlay | null = null
  private checkerTexture: Texture | null = null
  private resizeObserver: ResizeObserver | null = null
  private editorDocument: EditorDocument | null = null
  private renderedDocumentSize = ''
  private readonly renderedLayerSignatures = new Map<string, string>()
  private renderedSourceSignature = ''
  private initialized = false
  private spacePressed = false
  private panningPointerId: number | null = null
  private lastPointer: ScreenPoint = { x: 0, y: 0 }
  private refreshFrame: number | null = null
  private lastRenderDurationMs = 0
  private renderFrame: number | null = null
  private contextLost = false
  private suspended = false

  constructor(options: PixiViewportRendererOptions = {}) {
    this.workspaceBackground = options.workspaceBackground ?? '#141414'
    this.sourceRegistry = options.sourceRegistry ?? rasterSources
    this.textures = new RasterTextureCache(this.sourceRegistry)
    this.onViewChange = options.onViewChange
    this.onError = options.onError
    this.effects = new EffectPreviewCache(this.sourceRegistry, () => { if (this.initialized) this.renderDocument() }, message => this.onError?.(message), busy => { if (this.initialized) this.app.canvas.setAttribute('aria-busy', String(busy)) })
  }

  async initialize(host: HTMLElement): Promise<void> {
    if (this.initialized) return
    this.host = host
    await this.app.init({
      antialias: false,
      background: this.workspaceBackground,
      resolution: Math.min(window.devicePixelRatio, 2),
      autoDensity: true,
      powerPreference: 'high-performance',
      autoStart: false,
      preference: 'webgl',
    })
    const gl = this.app.canvas.getContext('webgl2') ?? this.app.canvas.getContext('webgl')
    if (gl) this.textures.configureMaxTextureSize(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number)
    this.app.canvas.setAttribute('aria-label', 'Document canvas')
    this.app.canvas.className = 'block h-full w-full touch-none'
    host.appendChild(this.app.canvas)
    this.app.canvas.addEventListener('webglcontextlost', this.onContextLost)
    this.app.canvas.addEventListener('webglcontextrestored', this.onContextRestored)
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    document.fonts?.addEventListener('loadingdone', this.onFontsLoaded)
    this.ruler = new RulerOverlay()
    host.appendChild(this.ruler.canvas)
    this.checkerTexture = createCheckerTexture()
    this.app.stage.addChild(this.documentRoot)
    this.attachInteractions()
    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      this.resize(entry.contentRect.width, entry.contentRect.height)
    })
    this.resizeObserver.observe(host)
    this.initialized = true
    this.resize(host.clientWidth, host.clientHeight)
    this.renderDocument()
  }

  setDocument(editorDocument: EditorDocument | null): void {
    if (this.editorDocument?.id !== editorDocument?.id) this.effects.invalidate()
    this.editorDocument = editorDocument
    this.viewport.setDocument(editorDocument?.dimensions ?? null)
    if (this.initialized) this.renderDocument()
    this.commitView()
  }

  getCanvas(): HTMLCanvasElement { return this.app.canvas }

  clientToDocument(clientX: number, clientY: number): ScreenPoint {
    return this.viewport.screenToDocument(this.localPoint(clientX, clientY))
  }

  documentToScreen(point: ScreenPoint): ScreenPoint { return this.viewport.documentToScreen(point) }
  getZoom(): number { return this.viewport.zoom }
  getViewState(): ViewState { return { zoom: this.viewport.zoom, origin: { ...this.viewport.origin }, center: this.viewport.getCenter() } }
  setViewState(state: ViewState): void { this.viewport.restoreView(state.zoom, state.center); this.commitView() }
  getLastRenderDuration(): number { return this.lastRenderDurationMs }
  getEstimatedGpuTextureBytes(): number { return this.textures.estimatedGpuBytes + this.cachedGroupBytes }

  /** Reads only a small document-space region; the checkerboard and selection UI are excluded. */
  sampleRegion(x: number, y: number, size: number, mode: 'visible' | 'active', activeLayerId: string | null): SampleRegion | null {
    if (!this.initialized || this.contextLost || !this.editorDocument || !this.layerRoot) return null
    const radius = Math.floor(size / 2)
    const left = Math.floor(x) - radius
    const top = Math.floor(y) - radius
    const hidden = new Map<Container, boolean>()
    const setVisible = (display: Container, visible: boolean): void => {
      hidden.set(display, display.visible)
      display.visible = visible
    }
    try {
      // The first child is a screen-only checkerboard (or opaque document background);
      // the last is the document outline. Neither belongs in an active-layer sample.
      const background = this.documentRoot.children[0]
      const outline = this.documentRoot.children[2]
      if (background && (mode === 'active' || this.editorDocument.background === 'transparent')) setVisible(background, false)
      if (outline) setVisible(outline, false)
      if (mode === 'active') {
        const path = activeLayerId ? findLayerPath(this.editorDocument.layers, activeLayerId) : null
        this.setSampleIsolationGroups(path?.slice(0, -1) ?? [])
        if (!path) return { pixels: new Uint8ClampedArray(size * size * 4), width: size, height: size, x: left, y: top }
        const allowed = new Set(path)
        const active = flattenLayers(this.editorDocument.layers).find((layer) => layer.id === activeLayerId)
        if (active?.kind === 'group') for (const child of flattenLayers(active.children)) allowed.add(child.id)
        for (const [id, display] of this.layerDisplays) {
          if (!allowed.has(id)) setVisible(display, false)
        }
      } else this.endSampling()
      const result = this.app.renderer.extract.pixels({ target: this.documentRoot, frame: new Rectangle(left, top, size, size), resolution: 1, antialias: false })
      // Pixi's WebGL extractor returns premultiplied channels; the picker and
      // Canvas magnifier need straight-alpha RGBA.
      for (let offset = 0; offset < result.pixels.length; offset += 4) {
        const alpha = result.pixels[offset + 3] ?? 0
        if (alpha === 0) result.pixels.fill(0, offset, offset + 3)
        else if (alpha < 255) for (let channel = 0; channel < 3; channel++) {
          result.pixels[offset + channel] = Math.min(255, Math.round((result.pixels[offset + channel] ?? 0) * 255 / alpha))
        }
      }
      for (let row = 0; row < result.height; row++) for (let column = 0; column < result.width; column++) {
        const documentX = left + column
        const documentY = top + row
        if (documentX >= 0 && documentY >= 0 && documentX < this.editorDocument.dimensions.width && documentY < this.editorDocument.dimensions.height) continue
        result.pixels.fill(0, (row * result.width + column) * 4, (row * result.width + column + 1) * 4)
      }
      return { pixels: result.pixels, width: result.width, height: result.height, x: left, y: top }
    } finally {
      for (const [display, visible] of hidden) display.visible = visible
    }
  }

  /** Restore group caches when eyedropper isolation ends or its target changes. */
  endSampling(): void { this.setSampleIsolationGroups([]) }

  private setSampleIsolationGroups(ids: readonly string[]): void {
    const next = new Set(ids)
    for (const id of this.sampleIsolationGroups) if (!next.has(id)) {
      this.cachedGroups.get(id)?.cacheAsTexture(true)
      this.sampleIsolationGroups.delete(id)
    }
    for (const id of next) if (!this.sampleIsolationGroups.has(id)) {
      this.cachedGroups.get(id)?.cacheAsTexture(false)
      this.sampleIsolationGroups.add(id)
    }
  }

  panByScreen(x: number, y: number): void { this.viewport.panBy({ x, y }); this.commitView() }

  zoomAtClient(clientX: number, clientY: number, factor: number): void {
    this.viewport.setZoomAt(this.viewport.zoom * factor, this.localPoint(clientX, clientY))
    this.commitView()
  }

  updateRasterSource(sourceId: string): void {
    if (this.editorDocument && flattenLayers(this.editorDocument.layers).some((layer) => layer.kind === 'group' && layer.adjustments.some(a => a.enabled) || layer.kind === 'raster' && (layer.mask?.enabled || layer.adjustments.some(a => a.enabled)) && (layer.pixelSourceId === sourceId || layer.mask?.pixelSourceId === sourceId))) {
      this.renderDocument()
      return
    }
    if (this.textures.update(sourceId)) {
      for (const groupId of this.sourceToCachedGroups.get(sourceId) ?? []) {
        if (!this.sampleIsolationGroups.has(groupId)) this.cachedGroups.get(groupId)?.updateCacheTexture()
      }
      this.requestRender()
    }
  }

  requestRender(): void {
    if (!this.initialized || this.contextLost || this.suspended || this.renderFrame !== null) return
    this.renderFrame = requestAnimationFrame(() => { this.renderFrame = null; if (this.initialized && !this.contextLost && !this.suspended) this.renderMeasured() })
  }

  scheduleRefreshDocument(): void {
    if (this.refreshFrame !== null) return
    this.refreshFrame = requestAnimationFrame(() => {
      this.refreshFrame = null
      this.refreshDocument()
    })
  }

  refreshDocument(): void {
    if (!this.initialized || !this.editorDocument || !this.layerRoot) return
    const displayLayers = displayedLayers(this.editorDocument.layers)
    const ids = displayLayers.map((layer) => layer.id)
    const documentSize = `${this.editorDocument.dimensions.width}:${this.editorDocument.dimensions.height}:${this.editorDocument.background}`
    const sourceSignature = visibilitySignature(this.editorDocument.layers)
    if (documentSize !== this.renderedDocumentSize) this.viewport.updateDocumentSize(this.editorDocument.dimensions)
    if (documentSize !== this.renderedDocumentSize || ids.length !== this.layerDisplays.size || ids.some((id) => !this.layerDisplays.has(id))) { this.renderDocument(); return }
    if (sourceSignature !== this.renderedSourceSignature) {
      if (!this.refreshVectorGeometry(displayLayers)) { this.renderDocument(); return }
      this.renderedSourceSignature = sourceSignature
    }
    this.syncLayerDisplays(this.layerRoot, this.editorDocument.layers)
    this.textures.updateChanged()
    this.refreshGroupCaches(this.editorDocument.layers)
    this.commitView()
  }

  private displaySignature(layer: Layer): string {
    if (layer.kind === 'vector') return `${JSON.stringify([layer.geometry, layer.style, layer.visible])}:${layer.style.scaleStroke === false ? this.vectorStrokeScale(layer) : ''}`
    if (layer.kind === 'group' && layer.booleanOperation) return JSON.stringify([layer.booleanOperation, layer.children, layer.visible, this.vectorStrokeScale(layer)])
    if (layer.kind === 'group') return `group:${layer.visible}:${JSON.stringify(layer.adjustments)}`
    return visibilitySignature([layer])
  }

  private refreshVectorGeometry(layers: readonly Layer[]): boolean {
    const changed = layers.filter(layer => this.renderedLayerSignatures.get(layer.id) !== this.displaySignature(layer))
    if (changed.some(layer => layer.kind !== 'vector' && !(layer.kind === 'group' && layer.booleanOperation))) return false
    for (const layer of changed) {
      const previous = this.layerDisplays.get(layer.id), parent = previous?.parent
      if (!previous || !parent) return false
      const index = parent.getChildIndex(previous)
      this.layerFilters.get(layer.id)?.forEach(filter => filter.destroy())
      this.layerFilters.delete(layer.id); this.filterSignatures.delete(layer.id)
      const next = this.createLayerDisplay(layer)
      if (!next) return false
      parent.addChildAt(next, index); previous.removeFromParent(); destroyDisplay(previous)
      this.renderedLayerSignatures.set(layer.id, this.displaySignature(layer))
    }
    return true
  }

  zoomAtCenter(factor: number): void {
    if (!this.host) return
    this.viewport.setZoomAt(this.viewport.zoom * factor, { x: this.host.clientWidth / 2, y: this.host.clientHeight / 2 })
    this.commitView()
  }

  setZoomAtCenter(zoom: number): void {
    if (!this.host) return
    this.viewport.setZoomAt(zoom, { x: this.host.clientWidth / 2, y: this.host.clientHeight / 2 })
    this.commitView()
  }

  fitToScreen(): void {
    this.viewport.fitToScreen()
    this.commitView()
  }

  actualSize(): void {
    this.viewport.actualSize()
    this.commitView()
  }

  resetView(): void {
    this.viewport.reset()
    this.commitView()
  }

  destroy(): void {
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.detachInteractions()
    if (this.refreshFrame !== null) cancelAnimationFrame(this.refreshFrame)
    this.refreshFrame = null
    if (this.renderFrame !== null) cancelAnimationFrame(this.renderFrame)
    this.renderFrame = null
    this.app.canvas.removeEventListener('webglcontextlost', this.onContextLost)
    this.app.canvas.removeEventListener('webglcontextrestored', this.onContextRestored)
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    document.fonts?.removeEventListener('loadingdone', this.onFontsLoaded)
    this.effects.destroy()
    this.destroyLayerResources()
    this.layerDisplays.clear()
    this.documentRoot.removeChildren().forEach(destroyDisplay)
    this.layerRoot = null
    this.checkerTexture?.destroy(true)
    this.checkerTexture = null
    this.ruler?.canvas.remove()
    this.ruler = null
    this.host = null
    if (this.initialized) {
      this.app.destroy({ removeView: true }, { children: true })
      this.initialized = false
    }
  }

  private resize(width: number, height: number): void {
    if (!this.initialized) return
    this.app.renderer.resize(Math.max(1, width), Math.max(1, height))
    this.viewport.resize({ width, height })
    this.ruler?.resize(width, height, Math.min(window.devicePixelRatio, 2))
    this.commitView()
  }

  private renderDocument(): void {
    this.destroyLayerResources()
    this.layerDisplays.clear()
    const oldChildren = this.documentRoot.removeChildren()
    oldChildren.forEach(destroyDisplay)
    if (!this.editorDocument || !this.checkerTexture) {
      this.commitView()
      return
    }

    const { width, height } = this.editorDocument.dimensions
    this.renderedDocumentSize = `${width}:${height}:${this.editorDocument.background}`
    this.renderedSourceSignature = visibilitySignature(this.editorDocument.layers)
    if (this.editorDocument.background === 'transparent') {
      this.documentRoot.addChild(new TilingSprite({ texture: this.checkerTexture, width, height }))
    } else {
      this.documentRoot.addChild(new Graphics().rect(0, 0, width, height).fill(0xffffff))
    }

    this.layerRoot = new Container()
    this.documentRoot.addChild(this.layerRoot)
    for (const layer of this.editorDocument.layers) {
      const display = this.createLayerDisplay(layer)
      if (display) this.layerRoot.addChild(display)
    }
    for (const layer of displayedLayers(this.editorDocument.layers)) this.renderedLayerSignatures.set(layer.id, this.displaySignature(layer))
    this.documentRoot.addChild(new Graphics().rect(0, 0, width, height).stroke({ color: 0x09090b, width: 1 }))
    this.commitView()
  }

  private commitView(): void {
    this.documentRoot.position.copyFrom(this.viewport.origin)
    this.documentRoot.scale.set(this.viewport.zoom)
    this.ruler?.render(this.viewport, this.editorDocument)
    this.onViewChange?.({ zoom: this.viewport.zoom, origin: this.viewport.origin, center: this.viewport.getCenter() })
    this.requestRender()
  }

  private destroyLayerResources(): void {
    this.imageFrames.clear()
    this.renderedLayerSignatures.clear()
    this.sampleIsolationGroups.clear()
    this.textures.clear()
    for (const id of this.maskedPreviewSources) this.sourceRegistry.remove(id)
    this.maskedPreviewSources.clear()
    this.layerFilters.forEach((filters) => filters.forEach((filter) => filter.destroy()))
    this.layerFilters.clear()
    this.filterSignatures.clear()
    this.groupCacheSignatures.clear()
    this.cachedGroups.clear()
    this.sourceToCachedGroups.clear()
    this.cachedGroupBytes = 0
  }

  private createLayerDisplay(layer: Layer, ancestors: readonly string[] = [], parentVisible = true): Container | null {
    const effectiveVisible = parentVisible && layer.visible
    let display: Container
    const hasEffects = (layer.kind === 'raster' || layer.kind === 'group' && !layer.booleanOperation) && layer.adjustments.some(a => a.enabled)
    const effectSource = hasEffects && effectiveVisible && this.editorDocument ? this.effects.get(layer, this.editorDocument.dimensions.width, this.editorDocument.dimensions.height) : null
    if (effectSource) {
      display = this.textures.createDisplay(effectSource) ?? new Container()
    } else if (layer.kind === 'group' && layer.booleanOperation) {
      try { display = createVectorGraphics(booleanGroupResult(layer), this.vectorStrokeScale(layer)) } catch { display = new Container(); this.onError?.(`Could not resolve boolean group “${layer.name}”.`) }
    } else if (layer.kind === 'group') {
      display = new Container()
      for (const child of layer.children) {
        const childDisplay = this.createLayerDisplay(child, [...ancestors, layer.id], effectiveVisible)
        if (childDisplay) display.addChild(childDisplay)
      }
      const pixels = (this.editorDocument?.dimensions.width ?? 0) * (this.editorDocument?.dimensions.height ?? 0)
      const bytes = pixels * 4
      if (effectiveVisible && layer.children.length > 1 && pixels <= 4_000_000 && this.cachedGroupBytes + bytes <= 64 * 1024 * 1024) {
        display.cacheAsTexture(true)
        this.cachedGroups.set(layer.id, display)
        this.groupCacheSignatures.set(layer.id, groupSignature(layer, this.sourceRegistry))
        this.cachedGroupBytes += bytes
      }
    } else if (layer.kind === 'vector') {
      try { display = createVectorGraphics(layer, this.vectorStrokeScale(layer)) }
      catch { this.onError?.(`Could not render vector layer “${layer.name}”.`); display = new Container() }
    } else if (layer.kind === 'text') {
      try {
        const id = this.sourceRegistry.registerCanvas(paintTextLayer(layer))
        this.maskedPreviewSources.add(id)
        display = this.textures.createDisplay(id) ?? new Container()
      } catch { this.onError?.(`Could not render text layer “${layer.name}”.`); display = new Container() }
    } else {
      const source = layer.pixelSourceId ? this.sourceRegistry.get(layer.pixelSourceId) : undefined
      if (!source || !effectiveVisible) display = new Container()
      else {
        try {
          const previewId = layer.mask?.enabled ? this.createMaskedPreview(layer) : layer.pixelSourceId
          display = this.textures.createDisplay(previewId ?? '') ?? new Container()
          if (layer.pixelSourceId) for (const groupId of ancestors) {
            const groups = this.sourceToCachedGroups.get(layer.pixelSourceId) ?? new Set<string>()
            groups.add(groupId); this.sourceToCachedGroups.set(layer.pixelSourceId, groups)
          }
        } catch {
          this.onError?.(`Could not render layer “${layer.name}”.`)
          return null
        }
      }
    }
    if (layer.kind === 'raster') {
      const content = display, frame = new Container(), mask = new Graphics()
      frame.addChild(content, mask); display = frame
      this.imageFrames.set(layer.id, { content, mask, signature: '' })
      this.syncImageFrame(display, layer)
    }
    applyLayerTransform(display, layer)
    display.alpha = layer.opacity
    display.blendMode = layer.blendMode
    display.visible = layer.visible
    this.syncFilters(display, layer)
    if (hasEffects && layer.kind === 'group') for (const child of flattenLayers(layer.children)) this.layerDisplays.delete(child.id)
    this.layerDisplays.set(layer.id, display)
    return display
  }

  private vectorStrokeScale(layer: Layer): number {
    const matrix = this.editorDocument ? layerWorldMatrix(this.editorDocument.layers, layer.id) : null
    return matrix ? Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2])) : 1
  }

  private createMaskedPreview(layer: Extract<Layer, { kind: 'raster' }>): string | null {
    if (!layer.pixelSourceId || !layer.mask?.enabled) return layer.pixelSourceId
    const source = this.sourceRegistry.get(layer.pixelSourceId)
    const mask = this.sourceRegistry.get(layer.mask.pixelSourceId)
    if (!source || !mask) return layer.pixelSourceId
    const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('2D canvas is unavailable for mask preview')
    context.drawImage(source.image, 0, 0)
    context.globalCompositeOperation = 'destination-in'
    context.drawImage(maskAlphaCanvas(mask, layer.mask.inverted), 0, 0)
    const id = this.sourceRegistry.registerCanvas(canvas)
    this.maskedPreviewSources.add(id)
    return id
  }

  private syncLayerDisplays(parent: Container, layers: readonly Layer[]): void {
    for (const layer of layers) {
      const display = this.layerDisplays.get(layer.id)
      if (!display) continue
      parent.addChild(display)
      if (layer.kind === 'raster') this.syncImageFrame(display, layer)
      applyLayerTransform(display, layer)
      display.alpha = layer.opacity
      display.blendMode = layer.blendMode
      display.visible = layer.visible
      this.syncFilters(display, layer)
      if (layer.kind === 'group' && !layer.booleanOperation && !layer.adjustments.some(a => a.enabled)) this.syncLayerDisplays(display, layer.children)
    }
  }

  private syncImageFrame(display: Container, layer: Extract<Layer, { kind: 'raster' }>): void {
    const frame = this.imageFrames.get(layer.id), signature = JSON.stringify(layer.crop ?? null)
    if (!frame || frame.signature === signature) return
    frame.signature = signature
    frame.content.position.set(layer.crop?.offsetX ?? 0, layer.crop?.offsetY ?? 0)
    frame.mask.clear()
    if (layer.crop) { const crop = layer.crop; frame.mask.rect(crop.x, crop.y, crop.width, crop.height).fill(0xffffff); display.mask = frame.mask }
    else display.mask = null
  }

  private refreshGroupCaches(layers: readonly Layer[]): void {
    for (const layer of layers) {
      if (layer.kind !== 'group') continue
      const cached = this.cachedGroups.get(layer.id)
      if (cached) {
        if (this.sampleIsolationGroups.has(layer.id)) { this.refreshGroupCaches(layer.children); continue }
        const signature = groupSignature(layer, this.sourceRegistry)
        if (signature !== this.groupCacheSignatures.get(layer.id)) {
          cached.updateCacheTexture()
          this.groupCacheSignatures.set(layer.id, signature)
        }
      }
      this.refreshGroupCaches(layer.children)
    }
  }

  private syncFilters(display: Container, layer: Layer): void {
    const signature = JSON.stringify(layer.adjustments)
    if (this.filterSignatures.get(layer.id) === signature) return
    this.layerFilters.get(layer.id)?.forEach((filter) => filter.destroy())
    const filters = layer.kind === 'raster' || layer.kind === 'group' ? [] : layer.adjustments.filter((adjustment) => adjustment.enabled).map(createPixiFilter)
    display.filters = filters
    this.layerFilters.set(layer.id, filters)
    this.filterSignatures.set(layer.id, signature)
  }

  private renderMeasured(): void {
    const started = performance.now()
    this.app.render()
    this.lastRenderDurationMs = performance.now() - started
  }

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault()
    this.contextLost = true
    if (this.renderFrame !== null) cancelAnimationFrame(this.renderFrame)
    this.renderFrame = null
  }

  private readonly onContextRestored = (): void => {
    this.contextLost = false
    // Pixi restores its WebGL resources; rebuilding re-uploads every live source.
    this.renderDocument()
  }

  private readonly onVisibilityChange = (): void => {
    this.suspended = document.hidden
    if (this.suspended && this.renderFrame !== null) { cancelAnimationFrame(this.renderFrame); this.renderFrame = null }
    if (!this.suspended) { this.textures.updateChanged(); this.requestRender() }
  }

  private readonly onFontsLoaded = (): void => { this.renderDocument() }

  private attachInteractions(): void {
    this.app.canvas.addEventListener('wheel', this.onWheel, { passive: false })
    this.app.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.app.canvas.addEventListener('pointermove', this.onPointerMove)
    this.app.canvas.addEventListener('pointerup', this.onPointerUp)
    this.app.canvas.addEventListener('pointercancel', this.onPointerUp)
    this.app.canvas.addEventListener('contextmenu', this.preventContextMenu)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }

  private detachInteractions(): void {
    this.app.canvas.removeEventListener('wheel', this.onWheel)
    this.app.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.app.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.app.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.app.canvas.removeEventListener('pointercancel', this.onPointerUp)
    this.app.canvas.removeEventListener('contextmenu', this.preventContextMenu)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
  }

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.editorDocument) return
    event.preventDefault()
    const point = this.localPoint(event.clientX, event.clientY)
    const factor = Math.exp(-event.deltaY * 0.0015)
    this.viewport.setZoomAt(this.viewport.zoom * factor, point)
    this.commitView()
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const shouldPan = event.button === 1 || (event.button === 0 && this.spacePressed)
    if (!shouldPan) return
    event.preventDefault()
    this.panningPointerId = event.pointerId
    this.lastPointer = { x: event.clientX, y: event.clientY }
    this.app.canvas.setPointerCapture(event.pointerId)
    this.app.canvas.style.cursor = 'grabbing'
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.panningPointerId !== event.pointerId) return
    const next = { x: event.clientX, y: event.clientY }
    this.viewport.panBy({ x: next.x - this.lastPointer.x, y: next.y - this.lastPointer.y })
    this.lastPointer = next
    this.commitView()
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.panningPointerId !== event.pointerId) return
    if (this.app.canvas.hasPointerCapture(event.pointerId)) this.app.canvas.releasePointerCapture(event.pointerId)
    this.panningPointerId = null
    this.updateCursor()
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'Space' || isTypingTarget(event.target)) return
    event.preventDefault()
    this.spacePressed = true
    this.updateCursor()
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== 'Space') return
    this.spacePressed = false
    this.updateCursor()
  }

  private readonly onBlur = (): void => {
    this.spacePressed = false
    this.panningPointerId = null
    this.updateCursor()
  }

  private readonly preventContextMenu = (event: Event): void => event.preventDefault()

  private updateCursor(): void {
    this.app.canvas.style.cursor = this.panningPointerId !== null ? 'grabbing' : this.spacePressed ? 'grab' : 'default'
  }

  private localPoint(clientX: number, clientY: number): ScreenPoint {
    const rect = this.app.canvas.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }
}

function createCheckerTexture(): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas is unavailable for transparency pattern')
  context.fillStyle = '#e4e4e7'
  context.fillRect(0, 0, 32, 32)
  context.fillStyle = '#c4c4c8'
  context.fillRect(0, 0, 16, 16)
  context.fillRect(16, 16, 16, 16)
  return Texture.from(canvas, true)
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

function flattenLayers(layers: readonly Layer[]): Layer[] {
  return layers.flatMap((layer) => layer.kind === 'group' ? [layer, ...flattenLayers(layer.children)] : [layer])
}

function findLayerPath(layers: readonly Layer[], id: string): string[] | null {
  for (const layer of layers) {
    if (layer.id === id) return [id]
    if (layer.kind === 'group') {
      const childPath = findLayerPath(layer.children, id)
      if (childPath) return [layer.id, ...childPath]
    }
  }
  return null
}

function visibilitySignature(layers: readonly Layer[]): string {
  return layers.map((layer) => layer.kind === 'group'
    ? `${layer.id}:${JSON.stringify(layer.adjustments)}:${layer.visible}:${layer.booleanOperation || layer.adjustments.some(a => a.enabled) || hasNonScalingStroke(layer.children) ? JSON.stringify(layer) : ''}:group[${visibilitySignature(layer.children)}]`
    : layer.kind === 'vector' ? `${layer.id}:${layer.visible}:${JSON.stringify(layer.geometry)}:${JSON.stringify(layer.style)}:${layer.style.scaleStroke === false ? JSON.stringify([layer.transform, layer.svgMatrix]) : ''}`
      : layer.kind === 'text' ? `${layer.id}:${layer.visible}:${layer.text}:${layer.fontFamily}:${layer.fontSize}:${layer.fontWeight}:${layer.fontStyle}:${layer.alignment}:${layer.color}:${layer.lineSpacing}:${JSON.stringify(layer.textBox)}`
      : `${layer.id}:${JSON.stringify(layer.adjustments)}:${layer.visible}:${layer.pixelSourceId ?? ''}:${layer.mask?.pixelSourceId ?? ''}:${layer.mask?.enabled ?? false}:${layer.mask?.inverted ?? false}:${layer.mask?.pixelSourceId ? rasterSources.get(layer.mask.pixelSourceId)?.revision ?? -1 : -1}`).join('|')
}

function groupSignature(layer: Layer, sources: RasterSourceRegistry): string {
  const metadata = [layer.id, layer.visible, layer.opacity, layer.blendMode, layer.transform.x, layer.transform.y,
    layer.transform.scaleX, layer.transform.scaleY, layer.transform.rotation, JSON.stringify(layer.adjustments)].join(':')
  if (layer.kind === 'group') return `${metadata}[${layer.children.map((child) => groupSignature(child, sources)).join('|')}]`
  if (layer.kind === 'vector') return `${metadata}:${JSON.stringify(layer.geometry)}:${JSON.stringify(layer.style)}`
  if (layer.kind === 'text') return `${metadata}:${layer.text}:${layer.fontFamily}:${layer.fontSize}:${layer.fontWeight}:${layer.fontStyle}:${layer.alignment}:${layer.color}:${layer.lineSpacing}:${JSON.stringify(layer.textBox)}`
  return `${metadata}:${layer.pixelSourceId ?? ''}:${layer.pixelSourceId ? sources.get(layer.pixelSourceId)?.revision ?? -1 : -1}:${layer.mask?.pixelSourceId ?? ''}:${layer.mask?.pixelSourceId ? sources.get(layer.mask.pixelSourceId)?.revision ?? -1 : -1}:${layer.mask?.enabled ?? false}:${layer.mask?.inverted ?? false}:${JSON.stringify(layer.crop)}`
}

function applyLayerTransform(display: Container, layer: Layer): void {
  const { x, y, scaleX, scaleY, rotation } = layer.transform
  const cos = Math.cos(rotation), sin = Math.sin(rotation)
  const a = cos * scaleX, b = sin * scaleX, c = -sin * scaleY, d = cos * scaleY
  const m = layer.svgMatrix
  display.setFromMatrix(m ? new Matrix(a * m[0] + c * m[1], b * m[0] + d * m[1], a * m[2] + c * m[3], b * m[2] + d * m[3], a * m[4] + c * m[5] + x, b * m[4] + d * m[5] + y) : new Matrix(a, b, c, d, x, y))
}

function destroyDisplay(display: Container): void {
  display.removeChildren().forEach(destroyDisplay)
  // No options: Graphics releases its owned geometry context as well as children.
  display.destroy()
}
function hasNonScalingStroke(layers: readonly Layer[]): boolean { return layers.some(layer => layer.kind === 'vector' ? layer.style.scaleStroke === false : layer.kind === 'group' && hasNonScalingStroke(layer.children)) }

/** Live boolean operands are model layers, not separately painted displays. */
function displayedLayers(layers: readonly Layer[]): Layer[] { return layers.flatMap(layer => layer.kind === 'group' && !layer.booleanOperation && !layer.adjustments.some(a => a.enabled) ? [layer, ...displayedLayers(layer.children)] : [layer]) }
