import { isObjectEditable } from './ObjectBounds'
import { ObjectManipulation, type CanvasAction, type CanvasControls } from './ObjectManipulation'
import { MultiVectorTransform } from './MultiVectorTransform'
import { geometryBounds, transformGeometryPath, type Bounds } from '../core/vector/PathGeometry'
import { resizeHandles, resizeTransform, rotateTransform } from '../core/vector/Transform'
import { worldMatrix } from './VectorToolController'
import { invertAffine, transformPoint, IDENTITY_MATRIX, type Point } from '../core/geometry/LayerCoordinates'
import type { AffineMatrix } from '../core/model/types'
import { VectorToolController } from './VectorToolController'
import { CropDocumentCommand, SetLayerTransformCommand } from '../core/commands/EditingCommands'
import type { EditorCore } from '../core/EditorCore'
import type { LayerTransform, RasterLayer, TextLayer, GroupLayer, VectorLayer, VectorStyle } from '../core/model/types'
import { createVectorArtwork } from '../core/vector/VectorCreation'
import { isShapeTool, shapeTools, type ShapeToolId } from './shapes'
import { shapeBounds, lineEndpoints } from './shapes/ShapeTool'
import { RasterStrokeService, type BrushSettings, type PencilSettings, type DocumentPoint, type DocumentRect, type RasterStrokeSession, type StrokeMode } from '../raster/RasterStroke'
import { rasterSources } from '../raster/RasterSourceRegistry'
import { InteractionOverlay } from '../renderer/InteractionOverlay'
import { DrawingOverlay } from '../renderer/DrawingOverlay'
import type { PixiViewportRenderer } from '../renderer/PixiViewportRenderer'
import type { EditorToolId as ToolId } from '../core/DocumentManager'
import { colorAt, type SampledColor } from '../raster/SampledColor'
import { editableRasterWorldMatrix } from '../core/geometry/LayerCoordinates'
import { SelectionMask, type SelectionOperation } from '../core/selection/SelectionMask'
import { SetSelectionCommand } from '../core/commands/SelectionCommands'
import { RetouchingService, type RetouchMode } from '../raster/Retouching'
import { AddTextLayerCommand } from '../core/commands/TextCommands'
import { paintTextLayer } from '../raster/TextPainter'
import { PaintBucketService } from '../raster/PaintBucket'
import { layerAtPoint } from './LayerHitTest'
import { snapMove } from './MoveSnapping'

export interface EyedropperSample {
  color: SampledColor
  pixels: Uint8ClampedArray
  width: number
  height: number
  x: number
  y: number
  clientX: number
  clientY: number
}

export interface ToolControllerOptions {
  getTextResizeMode?: () => 'box' | 'scale'
  onCanvasControls?: (state: CanvasControls | null) => void
  onEditText?: (id: string) => void
  getObjectSnapping?: () => { tolerance: number; grid: number; guidesX: number[]; guidesY: number[] }
  getTool: () => ToolId
  getBrush: () => BrushSettings
  getPencil: () => PencilSettings
  getBucket: () => { tolerance: number; opacity: number; color: [number, number, number, number] }
  getTransformOrigin: () => Point
  getAutoSelect: () => boolean
  getSnapToCanvas: () => boolean
  getShape: () => { fill: string | null; fillOpacity: number; stroke: string | null; strokeOpacity: number; strokeWidth: number; opacity: number; cornerRadius: number; sides: number; innerRadius: number; customPath: string; creationMode: 'layer' | 'compound' }
  onToolChange: (tool: ToolId) => void
  onError: (message: string) => void
  getSampleMode: () => 'visible' | 'active'
  onSamplePreview: (sample: EyedropperSample | null) => void
  onSampleCommit: (color: SampledColor) => void
}

type CropHandle = 'new' | 'move' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
type Gesture =
  | { kind: 'stroke'; session: RasterStrokeSession }
  | { kind: 'retouch'; mode: RetouchMode; last: DocumentPoint; diameter: number; opacity: number }
  | { kind: 'move'; layerId: string; start: DocumentPoint; before: LayerTransform }
  | { kind: 'hand'; x: number; y: number }
  | { kind: 'marquee'; shape: 'rectangle' | 'ellipse'; start: DocumentPoint; rect: DocumentRect; operation: SelectionOperation; moved: boolean }
  | { kind: 'lasso'; points: DocumentPoint[]; operation: SelectionOperation; moved: boolean }
  | { kind: 'crop'; handle: CropHandle; start: DocumentPoint; before: DocumentRect }
  | { kind: 'transform'; action: 'move' | 'scale' | 'rotate'; start: DocumentPoint; before: LayerTransform; center: DocumentPoint; width: number; height: number; startAngle: number; bounds: Bounds; handle: Point; parentInverse: AffineMatrix }
  | { kind: 'shape'; tool: ShapeToolId; start: DocumentPoint; end: DocumentPoint; shift: boolean; alt: boolean }

export class EditorToolController {
  private readonly objects: ObjectManipulation
  private readonly multiTransform: MultiVectorTransform
  private readonly vectorTools: VectorToolController
  private readonly canvas: HTMLCanvasElement
  private readonly overlay: InteractionOverlay
  private readonly drawingOverlay: DrawingOverlay
  private readonly strokes = new RasterStrokeService()
  private readonly retouching = new RetouchingService()
  private readonly paintBucket = new PaintBucketService()
  private gesture: Gesture | null = null
  private cropRect: DocumentRect | null = null
  private transformBaseline: { layerId: string; transform: LayerTransform } | null = null
  private spacePressed = false
  private currentTool: ToolId = 'move'
  private sampleFrame: number | null = null
  private pendingSample: { x: number; y: number } | null = null
  private activePointerId: number | null = null
  private lastCursorClient: { x: number; y: number } | null = null

  constructor(
    host: HTMLElement,
    private readonly renderer: PixiViewportRenderer,
    private readonly getEditor: () => EditorCore,
    private readonly options: ToolControllerOptions,
  ) {
    this.canvas = renderer.getCanvas()
    this.canvas.tabIndex = 0
    this.vectorTools = new VectorToolController(host, renderer, getEditor, options)
    this.overlay = new InteractionOverlay(host, renderer)
    this.objects = new ObjectManipulation(getEditor, renderer, this.overlay, options)
    this.multiTransform = new MultiVectorTransform(getEditor, renderer, this.overlay, options)
    this.drawingOverlay = new DrawingOverlay(host, renderer,
      () => this.editor.document?.dimensions ?? null,
      () => {
        const document = this.editor.document
        return document?.activeLayerId ? editableRasterWorldMatrix(document.layers, document.activeLayerId) : null
      })
    this.canvas.addEventListener('wheel', this.onCanvasNavigation, { capture: true, passive: true })
    this.canvas.addEventListener('dblclick', this.onDoubleClick)
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('pointercancel', this.onPointerCancel)
    this.canvas.addEventListener('lostpointercapture', this.onLostPointerCapture)
    this.canvas.addEventListener('pointerleave', this.onPointerLeave)
    window.addEventListener('keydown', this.onInteractionShortcut, true)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onWindowBlur)
    document.addEventListener('visibilitychange', this.onVisibilityChange)
  }

  private get editor(): EditorCore { return this.getEditor() }

  /** Ends transient interaction state before a different document becomes active. */
  suspend(): void {
    this.objects.cancel(true)
    this.options.onCanvasControls?.(null)
    this.multiTransform.cancel()
    this.vectorTools.suspend()
    if (this.transformBaseline) {
      const layer = this.editor.layers.find(this.transformBaseline.layerId)
      if (layer) { Object.assign(layer.transform, this.transformBaseline.transform); this.renderer.scheduleRefreshDocument() }
    }
    if (this.gesture?.kind === 'stroke') this.commitStroke(this.gesture.session)
    if (this.gesture?.kind === 'retouch') this.editor.commitTransaction()
    if (this.gesture?.kind === 'move') this.restoreMove(this.gesture)
    this.releasePointer()
    this.gesture = null
    this.cropRect = null
    this.transformBaseline = null
    this.currentTool = 'move'
    this.clearSample()
    this.renderer.endSampling()
    this.overlay.setState({ kind: 'none' })
    this.lastCursorClient = null
    this.drawingOverlay.clearCursor()
    this.drawingOverlay.setGridEnabled(false)
  }

  restoreSelection(): void {
    this.refreshOverlay()
  }

  setTool(tool: ToolId): void {
    if (tool !== this.currentTool) this.objects.cancel(true)
    if (tool !== 'move') this.options.onCanvasControls?.(null)
    if (tool !== this.currentTool) this.multiTransform.cancel()
    this.vectorTools.setTool(tool)
    if (tool === this.currentTool) {
      this.refreshOverlay()
      return
    }
    if (this.currentTool === 'transform' && this.transformBaseline) {
      const layer = this.editor.layers.find(this.transformBaseline.layerId)
      if (layer) Object.assign(layer.transform, this.transformBaseline.transform)
      this.renderer.scheduleRefreshDocument()
      this.transformBaseline = null
    }
    if (this.currentTool === 'crop') this.cropRect = null
    if (this.gesture?.kind === 'stroke') this.abortStroke(this.gesture.session)
    if (this.gesture?.kind === 'retouch') this.editor.cancelTransaction()
    if (this.gesture?.kind === 'move') this.restoreMove(this.gesture)
    this.releasePointer()
    this.gesture = null
    this.clearSample()
    if (this.currentTool === 'eyedropper') this.renderer.endSampling()
    this.currentTool = tool
    this.overlay.setSelectionOverlay(['move', 'direct-selection'].includes(tool) ? this.editor.selection : null)
    this.canvas.style.cursor = isShapeTool(tool) || ['pen', 'curvature-pen', 'freeform-pen'].includes(tool) ? 'crosshair' : tool === 'move' || tool === 'path-selection' ? 'move' : tool === 'hand' ? 'grab' : 'default'
    this.lastCursorClient = null
    this.drawingOverlay.clearCursor()
    this.updateDrawingOverlay()
    if (tool === 'crop') this.initializeCrop()
    else if (tool === 'transform') { if (!this.multiTransform.activate()) this.initializeTransform() }
    else if (tool === 'move') this.objects.refresh()
    else this.showSelection()
  }

  canvasAction(action: CanvasAction): void { this.objects.action(action); this.canvas.focus({ preventScroll: true }) }

  closePenPath(): void { this.vectorTools.closePath() }

  confirm(): void {
    const tool = this.options.getTool()
    if (tool === 'transform' && this.multiTransform.confirm()) { this.options.onToolChange('move'); return }
    if (['pen', 'curvature-pen', 'freeform-pen'].includes(tool)) { this.vectorTools.finish(); return }
    if (tool === 'crop' && this.cropRect) {
      this.editor.execute(new CropDocumentCommand(this.cropRect))
      this.cropRect = null
      this.options.onToolChange('move')
    } else if (tool === 'transform' && this.transformBaseline) {
      const layer = this.editor.layers.find(this.transformBaseline.layerId)
      if (layer) this.editor.commitExecuted(new SetLayerTransformCommand(layer.id, this.transformBaseline.transform, { ...layer.transform }))
      this.transformBaseline = null
      this.options.onToolChange('move')
    }
  }

  cancel(): void {
    this.objects.cancel(true)
    this.multiTransform.cancel()
    this.vectorTools.cancel()
    if (this.gesture?.kind === 'stroke') this.abortStroke(this.gesture.session)
    if (this.gesture?.kind === 'retouch') this.editor.cancelTransaction()
    if (this.gesture?.kind === 'move') this.restoreMove(this.gesture)
    this.releasePointer()
    if (this.transformBaseline) {
      const layer = this.editor.layers.find(this.transformBaseline.layerId)
      if (layer) Object.assign(layer.transform, this.transformBaseline.transform)
      this.renderer.scheduleRefreshDocument()
    }
    this.transformBaseline = null
    this.cropRect = null
    this.gesture = null
    this.options.onToolChange('move')
  }

  refreshOverlay(): void {
    this.overlay.setSelectionOverlay(['move', 'direct-selection'].includes(this.options.getTool()) ? this.editor.selection : null)
    this.vectorTools.refresh()
    if (['move', 'direct-selection'].includes(this.options.getTool())) this.objects.refresh()
    else if (this.gesture?.kind === 'shape') this.drawShape(this.gesture)
    else if (this.options.getTool() === 'transform') { if (this.multiTransform.active) this.multiTransform.refresh(); else this.drawTransform() }
    else if (this.options.getTool() === 'crop' && this.cropRect) this.overlay.setState({ kind: 'crop', rect: this.cropRect })
    else this.showSelection()
    this.updateDrawingOverlay()
  }

  destroy(): void {
    this.objects.cancel(true)
    this.multiTransform.cancel()
    this.vectorTools.destroy()
    this.canvas.removeEventListener('wheel', this.onCanvasNavigation, true)
    this.canvas.removeEventListener('dblclick', this.onDoubleClick)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel)
    this.canvas.removeEventListener('lostpointercapture', this.onLostPointerCapture)
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave)
    window.removeEventListener('keydown', this.onInteractionShortcut, true)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onWindowBlur)
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    if (this.gesture?.kind === 'stroke') this.abortStroke(this.gesture.session)
    if (this.gesture?.kind === 'retouch') this.editor.cancelTransaction()
    if (this.gesture?.kind === 'move') this.restoreMove(this.gesture)
    this.releasePointer()
    this.clearSample()
    this.renderer.endSampling()
    this.overlay.destroy()
    this.drawingOverlay.destroy()
  }

  private readonly onCanvasNavigation = (): void => { if (this.objects.dragging) { this.objects.cancel(); this.releasePointer(); this.refreshOverlay() } }

  private readonly onDoubleClick = (event: MouseEvent): void => {
    if (this.spacePressed || this.options.getTool() !== 'move' || !this.editor.document) return
    const point = this.renderer.clientToDocument(event.clientX, event.clientY), hit = layerAtPoint(this.editor.document.layers, point, this.renderer.getZoom())
    if (!hit) return
    event.preventDefault()
    this.editor.layers.select(hit.id, 'replace')
    if (hit.kind === 'vector') this.options.onToolChange('direct-selection')
    else if (hit.kind === 'text') this.options.onEditText?.(hit.id)
    else if (hit.kind === 'raster') this.objects.editImage(hit.id)
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button === 1 && this.objects.dragging) { this.objects.cancel(); this.releasePointer(); this.refreshOverlay() }
    if (event.button !== 0 || this.spacePressed || this.activePointerId !== null) return
    this.canvas.focus({ preventScroll: true })
    const documentPoint = this.renderer.clientToDocument(event.clientX, event.clientY)
    const tool = this.options.getTool()
    if (this.objects.pointerDown(event, documentPoint)) { this.canvas.setPointerCapture(event.pointerId); this.activePointerId = event.pointerId; return }
    if (this.multiTransform.pointerDown(event, documentPoint)) { this.canvas.setPointerCapture(event.pointerId); this.activePointerId = event.pointerId; return }
    if (this.vectorTools.pointerDown(event, documentPoint)) { this.canvas.setPointerCapture(event.pointerId); this.activePointerId = event.pointerId; return }
    if (tool === 'eyedropper') {
      event.preventDefault()
      const sample = this.sampleAt(event.clientX, event.clientY)
      if (sample) {
        this.options.onSamplePreview(sample)
        this.options.onSampleCommit(sample.color)
      }
    } else if (tool === 'brush' || tool === 'pencil' || tool === 'eraser') this.beginStroke(event, documentPoint, tool)
    else if (tool === 'paint-bucket') {
      try {
        const settings = this.options.getBucket()
        if (this.paintBucket.fill(this.editor, documentPoint, settings.color, settings.tolerance, settings.opacity)) this.renderer.refreshDocument()
      } catch (error) { this.options.onError(error instanceof Error ? error.message : 'Paint bucket failed') }
    }
    else if (tool === 'clone-stamp' || tool === 'spot-repair') this.beginRetouch(event, documentPoint, tool)
    else if (tool === 'text' && this.editor.document) {
      this.editor.execute(new AddTextLayerCommand(documentPoint.x, documentPoint.y))
      this.editor.setTextEditing(this.editor.document.activeLayerId)
    }
    else if (tool === 'move') this.beginMove(event, documentPoint)
    else if (tool === 'hand') this.gesture = { kind: 'hand', x: event.clientX, y: event.clientY }
    else if ((tool === 'marquee' || tool === 'ellipse-marquee') && this.editor.document) {
      this.gesture = { kind: 'marquee', shape: tool === 'marquee' ? 'rectangle' : 'ellipse', start: documentPoint, rect: { x: documentPoint.x, y: documentPoint.y, width: 0, height: 0 }, operation: selectionOperation(event), moved: false }
    } else if (tool === 'lasso' && this.editor.document) {
      this.gesture = { kind: 'lasso', points: [documentPoint], operation: selectionOperation(event), moved: false }
    } else if (tool === 'zoom') this.renderer.zoomAtClient(event.clientX, event.clientY, event.altKey ? 0.8 : 1.25)
    else if (tool === 'crop') this.beginCrop(documentPoint)
    else if (tool === 'transform') this.beginTransform(documentPoint)
    else if (isShapeTool(tool) && this.editor.document) this.gesture = { kind: 'shape', tool, start: documentPoint, end: documentPoint, shift: event.shiftKey, alt: event.altKey }
    if (this.gesture) {
      event.preventDefault()
      this.canvas.setPointerCapture(event.pointerId)
      this.activePointerId = event.pointerId
    }
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.gesture && !this.spacePressed && this.objects.pointerMove(event, this.renderer.clientToDocument(event.clientX, event.clientY))) return
    if (this.multiTransform.pointerMove(event, this.renderer.clientToDocument(event.clientX, event.clientY))) return
    if (this.vectorTools.pointerMove(event, this.renderer.clientToDocument(event.clientX, event.clientY))) return
    const activeTool = this.options.getTool()
    if (activeTool === 'brush' || activeTool === 'pencil' || activeTool === 'eraser' || activeTool === 'clone-stamp' || activeTool === 'spot-repair') {
      this.lastCursorClient = { x: event.clientX, y: event.clientY }
      this.updateDrawingOverlay()
    }
    if (this.options.getTool() === 'eyedropper' && !this.spacePressed) {
      this.pendingSample = { x: event.clientX, y: event.clientY }
      if (this.sampleFrame === null) this.sampleFrame = requestAnimationFrame(() => {
        this.sampleFrame = null
        const pending = this.pendingSample
        if (pending && this.options.getTool() === 'eyedropper') this.options.onSamplePreview(this.sampleAt(pending.x, pending.y))
      })
      return
    }
    const gesture = this.gesture
    if (!gesture) return
    const point = this.renderer.clientToDocument(event.clientX, event.clientY)
    if (gesture.kind === 'stroke') {
      const events = event.getCoalescedEvents?.() ?? [event]
      events.forEach((sample) => gesture.session.addPoint(this.renderer.clientToDocument(sample.clientX, sample.clientY), pressureOf(sample)))
      this.renderer.updateRasterSource(gesture.session.sourceId)
    } else if (gesture.kind === 'retouch') {
      const spacing = Math.max(1, gesture.diameter / 4)
      const length = distance(gesture.last, point)
      if (length >= spacing) {
        const steps = Math.min(256, Math.floor(length / spacing))
        const start = gesture.last
        try {
          for (let i = 1; i <= steps; i++) this.retouching.dab(this.editor, { x: start.x + (point.x - start.x) * i / steps, y: start.y + (point.y - start.y) * i / steps }, gesture.mode, gesture.diameter, gesture.opacity)
          gesture.last = point
          this.renderer.refreshDocument()
        } catch (error) {
          this.editor.cancelTransaction(); this.gesture = null; this.releasePointer()
          this.options.onError(error instanceof Error ? error.message : 'Retouching failed')
        }
      }
    } else if (gesture.kind === 'move') {
      const layer = this.editor.layers.find(gesture.layerId)
      if (layer) {
        layer.transform.x = gesture.before.x + point.x - gesture.start.x
        layer.transform.y = gesture.before.y + point.y - gesture.start.y
        if (this.options.getSnapToCanvas() && this.editor.document) {
          const dimensions = this.editor.document.dimensions
          const snapped = snapMove(this.editor.document.layers, layer, dimensions.width, dimensions.height, this.renderer.getZoom())
          layer.transform.x = snapped.transform.x; layer.transform.y = snapped.transform.y
          this.overlay.setState({ kind: 'move-guides', vertical: snapped.vertical, horizontal: snapped.horizontal, width: dimensions.width, height: dimensions.height })
        }
        this.renderer.refreshDocument()
      }
    } else if (gesture.kind === 'hand') {
      this.renderer.panByScreen(event.clientX - gesture.x, event.clientY - gesture.y)
      gesture.x = event.clientX
      gesture.y = event.clientY
      this.refreshOverlay()
    } else if (gesture.kind === 'marquee') {
      if (distance(gesture.start, point) > 3 / this.renderer.getZoom()) gesture.moved = true
      gesture.rect = normalizedRect(gesture.start, point)
      this.overlay.setState({ kind: 'selection-preview', rect: gesture.rect, shape: gesture.shape })
    } else if (gesture.kind === 'lasso') {
      if (distance(gesture.points[0]!, point) > 3 / this.renderer.getZoom()) gesture.moved = true
      if (distance(gesture.points[gesture.points.length - 1]!, point) >= 0.5) gesture.points.push(point)
      this.overlay.setState({ kind: 'lasso-preview', points: gesture.points })
    } else if (gesture.kind === 'crop') {
      this.updateCrop(gesture, point)
    } else if (gesture.kind === 'transform') {
      this.updateTransform(gesture, point, event.shiftKey, event.altKey)
    } else if (gesture.kind === 'shape') {
      gesture.end = point; gesture.shift = event.shiftKey; gesture.alt = event.altKey; this.drawShape(gesture)
    }
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.activePointerId !== event.pointerId) return
    if (this.objects.pointerUp(event)) { this.releasePointer(); return }
    if (this.multiTransform.pointerUp(event)) { this.releasePointer(); return }
    if (this.vectorTools.pointerUp(event)) { this.releasePointer(); return }
    const gesture = this.gesture
    if (!gesture) return
    if (gesture.kind === 'stroke') {
      gesture.session.addPoint(this.renderer.clientToDocument(event.clientX, event.clientY), event.pointerType === 'mouse' ? 1 : event.pressure)
      this.commitStroke(gesture.session)
    } else if (gesture.kind === 'retouch') {
      this.editor.commitTransaction()
    } else if (gesture.kind === 'move') {
      const layer = this.editor.layers.find(gesture.layerId)
      if (layer && (layer.transform.x !== gesture.before.x || layer.transform.y !== gesture.before.y))
        this.editor.commitExecuted(new SetLayerTransformCommand(layer.id, gesture.before, { ...layer.transform }))
    } else if (gesture.kind === 'marquee') {
      const document = this.editor.document
      if (document) {
        const end = this.renderer.clientToDocument(event.clientX, event.clientY)
        const rect = normalizedRect(gesture.start, end)
        if (!gesture.moved && distance(gesture.start, end) <= 3 / this.renderer.getZoom()) {
          if (gesture.operation === 'new' && this.editor.selection) this.editor.execute(new SetSelectionCommand('Deselect', this.editor.selection, null))
        } else if (rect.width > 0 && rect.height > 0) {
          const incoming = gesture.shape === 'ellipse'
            ? SelectionMask.ellipse(document.dimensions.width, document.dimensions.height, rect)
            : SelectionMask.rectangle(document.dimensions.width, document.dimensions.height, rect)
          const before = this.editor.selection
          const after = gesture.operation === 'new' ? incoming : (before ?? SelectionMask.empty(document.dimensions.width, document.dimensions.height)).combine(incoming, gesture.operation)
          this.editor.execute(new SetSelectionCommand(`${gesture.operation === 'new' ? 'Select' : gesture.operation} ${gesture.shape}`, before, after))
        }
      }
    } else if (gesture.kind === 'lasso') {
      const document = this.editor.document
      if (document) {
        const end = this.renderer.clientToDocument(event.clientX, event.clientY)
        if (!gesture.moved && distance(gesture.points[0]!, end) <= 3 / this.renderer.getZoom()) {
          if (gesture.operation === 'new' && this.editor.selection) this.editor.execute(new SetSelectionCommand('Deselect', this.editor.selection, null))
        } else {
          gesture.points.push(end)
          const incoming = SelectionMask.polygon(document.dimensions.width, document.dimensions.height, gesture.points)
          if (!incoming.isEmpty) {
            const before = this.editor.selection
            const after = gesture.operation === 'new' ? incoming : (before ?? SelectionMask.empty(document.dimensions.width, document.dimensions.height)).combine(incoming, gesture.operation)
            this.editor.execute(new SetSelectionCommand('Select Lasso', before, after))
          }
        }
      }
    } else if (gesture.kind === 'shape') {
      gesture.end = this.renderer.clientToDocument(event.clientX, event.clientY)
      gesture.shift = event.shiftKey; gesture.alt = event.altKey
      const bounds = this.boundsForShape(gesture)
      if ((gesture.tool === 'line' || gesture.tool === 'arrow') ? bounds.width >= 1 || bounds.height >= 1 : bounds.width >= 1 && bounds.height >= 1) {
        const settings = this.options.getShape()
        const tool = shapeTools[gesture.tool]
        const style: VectorStyle = { fill: (gesture.tool === 'line' || gesture.tool === 'arrow') ? null : settings.fill, fillOpacity: settings.fillOpacity, stroke: (gesture.tool === 'line' || gesture.tool === 'arrow') ? (settings.stroke ?? settings.fill) : settings.stroke, strokeOpacity: (gesture.tool === 'line' || gesture.tool === 'arrow') ? (settings.stroke ? settings.strokeOpacity : settings.fillOpacity) : settings.strokeOpacity, strokeWidth: settings.strokeWidth, ...(gesture.tool === 'arrow' ? { endArrow: true } : {}), fillRule: 'nonzero' }
        const endpoints = lineEndpoints(gesture.start, gesture.end, gesture.alt, gesture.shift)
        const geometry = gesture.tool === 'custom-shape' ? { type: 'path' as const, d: transformGeometryPath({ type: 'path', d: settings.customPath }, [bounds.width, 0, 0, bounds.height, 0, 0]) } : (gesture.tool === 'line' || gesture.tool === 'arrow')
          ? { type: 'line' as const, x1: endpoints.start.x - bounds.x, y1: endpoints.start.y - bounds.y, x2: endpoints.end.x - bounds.x, y2: endpoints.end.y - bounds.y }
          : tool.geometry(bounds, settings.cornerRadius, settings.sides, settings.innerRadius)
        try { createVectorArtwork(this.editor, tool.label, bounds.x, bounds.y, geometry, style, settings.opacity, settings.creationMode) } catch (error) { this.options.onError(error instanceof Error ? error.message : 'Shape creation failed') }
      }
    }
    this.gesture = null
    this.releasePointer()
    this.refreshOverlay()
  }

  private readonly onPointerCancel = (event: PointerEvent): void => {
    this.objects.cancel()
    if (this.activePointerId !== event.pointerId) return
    if (this.multiTransform.active || this.gesture?.kind === 'transform') { this.cancel(); this.refreshOverlay(); return }
    this.multiTransform.cancel()
    this.vectorTools.cancel()
    if (this.gesture?.kind === 'stroke') this.abortStroke(this.gesture.session)
    if (this.gesture?.kind === 'retouch') this.editor.cancelTransaction()
    if (this.gesture?.kind === 'move') this.restoreMove(this.gesture)
    this.gesture = null
    this.releasePointer()
    this.refreshOverlay()
  }

  private readonly onWindowBlur = (): void => {
    this.objects.cancel()
    if (this.multiTransform.active || this.gesture?.kind === 'transform') { this.cancel(); this.refreshOverlay(); return }
    this.multiTransform.cancel()
    this.vectorTools.cancel()
    if (this.gesture?.kind === 'stroke') this.abortStroke(this.gesture.session)
    if (this.gesture?.kind === 'retouch') this.editor.cancelTransaction()
    if (this.gesture?.kind === 'move') this.restoreMove(this.gesture)
    this.gesture = null
    this.releasePointer()
    this.lastCursorClient = null
    this.drawingOverlay.clearCursor()
    this.refreshOverlay()
  }

  private readonly onVisibilityChange = (): void => { if (document.hidden) this.onWindowBlur() }
  private readonly onLostPointerCapture = (): void => {
    this.objects.cancel()
    if (this.multiTransform.dragging || this.gesture?.kind === 'transform') { this.cancel(); this.refreshOverlay(); return }
    if (this.vectorTools.dragging) this.vectorTools.cancel()
    if (this.gesture?.kind === 'stroke') this.abortStroke(this.gesture.session)
    if (this.gesture?.kind === 'retouch') this.editor.cancelTransaction()
    if (this.gesture?.kind === 'move') this.restoreMove(this.gesture)
    this.gesture = null
    this.activePointerId = null
    this.refreshOverlay()
  }

  private drawShape(gesture: Extract<Gesture, { kind: 'shape' }>): void {
    const endpoints = gesture.tool === 'line' || gesture.tool === 'arrow' ? lineEndpoints(gesture.start, gesture.end, gesture.alt, gesture.shift) : { start: gesture.start, end: gesture.end }
    this.overlay.setState({ kind: 'shape', shape: gesture.tool, rect: this.boundsForShape(gesture), radius: this.options.getShape().cornerRadius, sides: this.options.getShape().sides, innerRadius: this.options.getShape().innerRadius, start: endpoints.start, end: endpoints.end, customPath: this.options.getShape().customPath })
  }

  private boundsForShape(gesture: Extract<Gesture, { kind: 'shape' }>): DocumentRect {
    if (gesture.tool === 'line' || gesture.tool === 'arrow') { const endpoints = lineEndpoints(gesture.start, gesture.end, gesture.alt, gesture.shift); return normalizedRect(endpoints.start, endpoints.end) }
    return shapeBounds(gesture.start, gesture.end, gesture.alt, gesture.shift || gesture.tool === 'circle')
  }

  private updateDrawingOverlay(): void {
    const tool = this.options.getTool()
    this.drawingOverlay.setGridEnabled(tool === 'pencil' && Boolean(this.options.getPencil().pixelGrid))
    if (!this.lastCursorClient || (tool !== 'brush' && tool !== 'pencil' && tool !== 'eraser' && tool !== 'clone-stamp' && tool !== 'spot-repair') || this.spacePressed) {
      this.drawingOverlay.clearCursor()
      return
    }
    const diameter = tool === 'pencil' ? this.options.getPencil().diameter : this.options.getBrush().diameter
    this.drawingOverlay.setCursor(this.lastCursorClient.x, this.lastCursorClient.y, tool === 'clone-stamp' || tool === 'spot-repair' ? 'brush' : tool, diameter)
  }

  private commitStroke(session: RasterStrokeSession): void {
    const command = session.finish()
    if (command) this.editor.commitExecuted(command)
    this.renderer.updateRasterSource(session.sourceId)
    this.renderer.refreshDocument()
  }

  private abortStroke(session: RasterStrokeSession): void {
    session.abort()
    this.renderer.updateRasterSource(session.sourceId)
    this.renderer.refreshDocument()
  }

  private releasePointer(): void {
    if (this.activePointerId !== null && this.canvas.hasPointerCapture(this.activePointerId)) this.canvas.releasePointerCapture(this.activePointerId)
    this.activePointerId = null
  }

  private readonly onPointerLeave = (): void => { this.clearSample(); this.lastCursorClient = null; this.drawingOverlay.clearCursor() }

  private clearSample(): void {
    if (this.sampleFrame !== null) cancelAnimationFrame(this.sampleFrame)
    this.sampleFrame = null
    this.pendingSample = null
    this.options.onSamplePreview(null)
  }

  private sampleAt(clientX: number, clientY: number): EyedropperSample | null {
    const point = this.renderer.clientToDocument(clientX, clientY)
    const document = this.editor.document
    if (!document || point.x < 0 || point.y < 0 || point.x >= document.dimensions.width || point.y >= document.dimensions.height) return null
    try {
      const region = this.renderer.sampleRegion(point.x, point.y, 9, this.options.getSampleMode(), document.activeLayerId)
      if (!region) return null
      const centerX = Math.floor(point.x) - region.x
      const centerY = Math.floor(point.y) - region.y
      return { ...region, color: colorAt(region.pixels, region.width, centerX, centerY), clientX, clientY }
    } catch {
      this.options.onError('Color sampling is unavailable while the GPU is recovering.')
      return null
    }
  }

  private beginStroke(event: PointerEvent, point: DocumentPoint, tool: StrokeMode): void {
    const document = this.editor.document
    const layer = document?.activeLayerId ? this.editor.layers.find(document.activeLayerId) : null
    if (!document || !layer || layer.kind !== 'raster' || layer.locked || !layer.visible) {
      this.options.onError('Select a visible, unlocked raster layer before painting.')
      return
    }
    try {
      const settings = tool === 'pencil' ? this.options.getPencil() : this.options.getBrush()
      const maskTarget = this.editor.maskEditingLayerId === layer.id && !!layer.mask
      const gray = Math.round(0.2126 * parseInt(settings.color.slice(1, 3), 16) + 0.7152 * parseInt(settings.color.slice(3, 5), 16) + 0.0722 * parseInt(settings.color.slice(5, 7), 16))
      const grayHex = `#${gray.toString(16).padStart(2, '0').repeat(3)}`
      const paintSettings = maskTarget ? { ...settings, color: tool === 'eraser' ? '#ffffff' : grayHex, colorAlpha: 1 }
        : tool === 'eraser' ? { ...settings, colorAlpha: 1 } : settings
      const session = this.strokes.begin(document, layer, paintSettings, maskTarget && tool === 'eraser' ? 'brush' : tool, this.editor.selection, maskTarget ? 'mask' : 'pixels')
      this.renderer.refreshDocument()
      session.addPoint(point, pressureOf(event))
      this.renderer.updateRasterSource(session.sourceId)
      this.gesture = { kind: 'stroke', session }
    } catch (error) {
      this.options.onError(error instanceof Error ? error.message : 'The stroke could not be started.')
    }
  }

  private beginRetouch(event: PointerEvent, point: DocumentPoint, mode: RetouchMode): void {
    if (mode === 'clone-stamp' && event.altKey) { this.retouching.setSample(point); return }
    const settings = this.options.getBrush()
    try {
      this.editor.beginTransaction(mode === 'clone-stamp' ? 'Clone Stamp' : 'Spot Repair')
      this.retouching.dab(this.editor, point, mode, settings.diameter, settings.opacity)
      this.gesture = { kind: 'retouch', mode, last: point, diameter: settings.diameter, opacity: settings.opacity }
      this.renderer.refreshDocument()
    } catch (error) {
      this.editor.cancelTransaction()
      this.options.onError(error instanceof Error ? error.message : 'Retouching failed')
    }
  }

  private beginMove(_event: PointerEvent, point: DocumentPoint): void {
    const document = this.editor.document
    if (document && this.options.getAutoSelect()) {
      const hit = layerAtPoint(document.layers, point, this.renderer.getZoom())
      if (!hit) {
        const active = document.activeLayerId ? this.editor.layers.find(document.activeLayerId) : null
        if (active?.kind === 'raster' && !active.pixelSourceId && isObjectEditable(document.layers, active.id)) { this.gesture = { kind: 'move', layerId: active.id, start: point, before: { ...active.transform } }; return }
        return
      }
      if (hit.id !== document.activeLayerId || _event.shiftKey) this.editor.layers.select(hit.id, _event.shiftKey ? 'toggle' : 'replace')
      if (_event.detail === 2 && hit.kind === 'vector') { this.options.onToolChange('direct-selection'); return }
    }
    const layer = document?.activeLayerId ? this.editor.layers.find(document.activeLayerId) : null
    if (!layer || !document || !isObjectEditable(document.layers, layer.id)) {
      this.options.onError('Select a visible, unlocked layer before moving it.')
      return
    }
    this.gesture = { kind: 'move', layerId: layer.id, start: point, before: { ...layer.transform } }
  }

  private restoreMove(gesture: Extract<Gesture, { kind: 'move' }>): void {
    const layer = this.editor.layers.find(gesture.layerId)
    if (!layer) return
    Object.assign(layer.transform, gesture.before)
    this.renderer.refreshDocument()
  }

  private initializeCrop(): void {
    const dimensions = this.editor.document?.dimensions
    if (!dimensions) { this.options.onError('Open a document before cropping.'); this.options.onToolChange('move'); return }
    this.cropRect = { x: 0, y: 0, width: dimensions.width, height: dimensions.height }
    this.overlay.setState({ kind: 'crop', rect: this.cropRect })
  }

  private beginCrop(point: DocumentPoint): void {
    if (!this.cropRect) return
    const handle = hitCropHandle(this.cropRect, point, 10 / this.renderer.getZoom())
    this.gesture = { kind: 'crop', handle, start: point, before: { ...this.cropRect } }
  }

  private updateCrop(gesture: Extract<Gesture, { kind: 'crop' }>, point: DocumentPoint): void {
    const dimensions = this.editor.document?.dimensions
    if (!dimensions) return
    const delta = { x: point.x - gesture.start.x, y: point.y - gesture.start.y }
    let rect = { ...gesture.before }
    if (gesture.handle === 'new') rect = normalizedRect(gesture.start, point)
    else if (gesture.handle === 'move') { rect.x += delta.x; rect.y += delta.y }
    else {
      if (gesture.handle.includes('w')) { rect.x += delta.x; rect.width -= delta.x }
      if (gesture.handle.includes('e')) rect.width += delta.x
      if (gesture.handle.includes('n')) { rect.y += delta.y; rect.height -= delta.y }
      if (gesture.handle.includes('s')) rect.height += delta.y
    }
    this.cropRect = constrainRect(rect, dimensions.width, dimensions.height)
    this.overlay.setState({ kind: 'crop', rect: this.cropRect })
  }

  private initializeTransform(): void {
    const layer = this.activeEditableTransformLayer()
    if (!layer) { this.options.onError('Select a visible, unlocked layer to transform.'); this.options.onToolChange('move'); return }
    this.transformBaseline = { layerId: layer.id, transform: { ...layer.transform } }
    this.drawTransform()
  }

  private beginTransform(point: DocumentPoint): void {
    const layer = this.activeEditableTransformLayer()
    const size = layer ? layerSize(layer, this.editor.document) : null
    if (!layer || !size) return
    const geometry = transformGeometry(layer, size, this.renderer.getZoom(), this.editor.document, this.options.getTransformOrigin())
    const threshold = 12 / this.renderer.getZoom()
    const rotationDistance = distance(point, geometry.rotationHandle)
    let action: 'move' | 'scale' | 'rotate' | null = rotationDistance <= threshold ? 'rotate' : null
    const handleIndex = geometry.handles.findIndex(handle => distance(point, handle) <= threshold)
    if (!action && handleIndex >= 0) action = 'scale'
    if (!action && pointInPolygon(point, geometry.corners)) action = 'move'
    if (!action) return
    const parentId = this.editor.layers.locationOf(layer.id)?.parentId
    const parent = parentId && this.editor.document ? worldMatrix(this.editor.document.layers, parentId) ?? IDENTITY_MATRIX : IDENTITY_MATRIX
    const parentInverse = invertAffine(parent), parentPoint = transformPoint(parentInverse, point), parentCenter = transformPoint(parentInverse, geometry.center)
    this.gesture = {
      kind: 'transform', action, start: point, before: { ...layer.transform }, center: parentCenter,
      bounds: size, handle: resizeHandles[Math.max(0, handleIndex)]!, parentInverse,
      width: size.width, height: size.height, startAngle: Math.atan2(parentPoint.y - parentCenter.y, parentPoint.x - parentCenter.x),
    }
  }

  private updateTransform(gesture: Extract<Gesture, { kind: 'transform' }>, point: DocumentPoint, constrained: boolean, fromCenter: boolean): void {
    point = transformPoint(gesture.parentInverse, point)
    const start = transformPoint(gesture.parentInverse, gesture.start)
    const layer = this.activeEditableTransformLayer()
    if (!layer) return
    if (gesture.action === 'move') {
      layer.transform.x = gesture.before.x + point.x - start.x
      layer.transform.y = gesture.before.y + point.y - start.y
    } else if (gesture.action === 'rotate') {
      let rotation = gesture.before.rotation + Math.atan2(point.y - gesture.center.y, point.x - gesture.center.x) - gesture.startAngle
      if (constrained) rotation = Math.round(rotation / (Math.PI / 12)) * (Math.PI / 12)
      Object.assign(layer.transform, rotateTransform(gesture.before, gesture.bounds, rotation, this.options.getTransformOrigin()))
    } else {
      Object.assign(layer.transform, resizeTransform(gesture.before, gesture.bounds, gesture.handle, point, fromCenter, constrained))
    }
    this.renderer.refreshDocument()
    this.drawTransform()
  }

  private drawTransform(): void {
    const layer = this.activeEditableTransformLayer()
    const size = layer ? layerSize(layer, this.editor.document) : null
    if (!layer || !size) { this.overlay.setState({ kind: 'none' }); return }
    const geometry = transformGeometry(layer, size, this.renderer.getZoom(), this.editor.document, this.options.getTransformOrigin())
    this.overlay.setState({ kind: 'transform', corners: geometry.corners, rotationHandle: geometry.rotationHandle })
  }

  private activeEditableTransformLayer(): RasterLayer | VectorLayer | TextLayer | GroupLayer | null {
    const document = this.editor.document
    const layer = document?.activeLayerId ? this.editor.layers.find(document.activeLayerId) : null
    return layer && (layer.kind === 'raster' || layer.kind === 'vector' || layer.kind === 'text' || layer.kind === 'group') && document && isObjectEditable(document.layers, layer.id) ? layer : null
  }

  private showSelection(): void {
    const selection = this.editor.selection
    this.overlay.setState(selection && !selection.isEmpty ? { kind: 'selection', mask: selection } : { kind: 'none' })
  }

  private readonly onInteractionShortcut = (event: KeyboardEvent): void => {
    if (this.objects.dragging && !isTypingTarget(event.target) && ((event.ctrlKey || event.metaKey) && ['z', 'w', 't', 's', '0', '1'].includes(event.key.toLowerCase()) || event.code === 'Space')) { this.objects.cancel(); this.releasePointer(); this.refreshOverlay() }
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!isTypingTarget(event.target) && this.objects.keyDown(event)) return
    if (this.vectorTools.keyDown(event)) return
    if ((event.ctrlKey || event.metaKey) && !isTypingTarget(event.target) && this.editor.document) {
      const key = event.key.toLowerCase()
      const document = this.editor.document
      const before = this.editor.selection
      let after: SelectionMask | null | undefined
      let label = ''
      if (key === 'a' && !event.shiftKey) { after = SelectionMask.all(document.dimensions.width, document.dimensions.height); label = 'Select All' }
      else if (key === 'd' && !event.shiftKey) { after = null; label = 'Deselect' }
      else if (key === 'i' && event.shiftKey) { after = before ? before.invert() : SelectionMask.all(document.dimensions.width, document.dimensions.height); label = 'Invert Selection' }
      if (after !== undefined) { event.preventDefault(); if (after !== before) this.editor.execute(new SetSelectionCommand(label, before, after)); return }
    }
    if (event.code === 'Space' && !isTypingTarget(event.target)) this.spacePressed = true
    if (event.key === 'Enter' && !isTypingTarget(event.target)) this.confirm()
    if (event.key === 'Escape' && !isTypingTarget(event.target)) this.cancel()
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => { if (event.code === 'Space') this.spacePressed = false }
}

function pressureOf(event: PointerEvent): number { return event.pointerType === 'mouse' ? 1 : Math.max(0.01, event.pressure) }
function selectionOperation(event: PointerEvent): SelectionOperation { return event.shiftKey && event.altKey ? 'intersect' : event.shiftKey ? 'add' : event.altKey ? 'subtract' : 'new' }
function normalizedRect(a: DocumentPoint, b: DocumentPoint): DocumentRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
}
function constrainRect(rect: DocumentRect, width: number, height: number): DocumentRect {
  const normalized = rect.width < 0 || rect.height < 0
    ? normalizedRect({ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height }) : rect
  const w = Math.max(1, Math.min(width, normalized.width))
  const h = Math.max(1, Math.min(height, normalized.height))
  return { x: Math.max(0, Math.min(width - w, normalized.x)), y: Math.max(0, Math.min(height - h, normalized.y)), width: w, height: h }
}
function hitCropHandle(rect: DocumentRect, point: DocumentPoint, threshold: number): CropHandle {
  const xs = [rect.x, rect.x + rect.width / 2, rect.x + rect.width]
  const ys = [rect.y, rect.y + rect.height / 2, rect.y + rect.height]
  const names: CropHandle[][] = [['nw', 'n', 'ne'], ['w', 'move', 'e'], ['sw', 's', 'se']]
  for (let y = 0; y < 3; y += 1) for (let x = 0; x < 3; x += 1) {
    if (distance(point, { x: xs[x] ?? 0, y: ys[y] ?? 0 }) <= threshold) return names[y]?.[x] ?? 'new'
  }
  if (point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height) return 'move'
  return 'new'
}
function layerSize(layer: RasterLayer | VectorLayer | TextLayer | GroupLayer, document: EditorCore['document']): Bounds | null {
  let bounds: Bounds
  if (layer.kind === 'group') {
    const children = layer.children.filter(child => child.visible).flatMap(child => { const b = layerSize(child, document); if (!b) return []; return [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }].map(p => { const q = rotatePoint({ x: p.x * child.transform.scaleX, y: p.y * child.transform.scaleY }, child.transform.rotation); return { x: q.x + child.transform.x, y: q.y + child.transform.y } }) })
    if (!children.length) return null
    const x = Math.min(...children.map(p => p.x)), y = Math.min(...children.map(p => p.y)); bounds = { x, y, width: Math.max(...children.map(p => p.x)) - x, height: Math.max(...children.map(p => p.y)) - y }
    if (layer.svgMatrix) bounds = geometryBounds({ type: 'path', d: transformGeometryPath({ type: 'rect', ...bounds, rx: 0, ry: 0 }, layer.svgMatrix) })
  } else if (layer.kind === 'vector') bounds = layer.svgMatrix ? geometryBounds({ type: 'path', d: transformGeometryPath(layer.geometry, layer.svgMatrix) }) : geometryBounds(layer.geometry)
  else if (layer.kind === 'text') { const canvas = paintTextLayer(layer); bounds = { x: 0, y: 0, width: canvas.width, height: canvas.height } }
  else { if (layer.crop) return { ...layer.crop }; const source = layer.pixelSourceId ? rasterSources.get(layer.pixelSourceId) : null; if (!source && !document) return null; bounds = { x: 0, y: 0, width: source?.width ?? document!.dimensions.width, height: source?.height ?? document!.dimensions.height } }
  return bounds
}
function transformGeometry(layer: RasterLayer | VectorLayer | TextLayer | GroupLayer, bounds: Bounds, zoom: number, document: EditorCore['document'], origin: Point) {
  const parentId = document ? findParent(document.layers, layer.id) : null
  const parent = parentId && document ? worldMatrix(document.layers, parentId) ?? IDENTITY_MATRIX : IDENTITY_MATRIX
  const local = (point: DocumentPoint): DocumentPoint => {
    const p = rotatePoint({ x: point.x * layer.transform.scaleX, y: point.y * layer.transform.scaleY }, layer.transform.rotation)
    return transformPoint(parent, { x: layer.transform.x + p.x, y: layer.transform.y + p.y })
  }
  const handles = resizeHandles.map(p => local({ x: bounds.x + bounds.width * p.x, y: bounds.y + bounds.height * p.y }))
  const corners = [handles[0]!, handles[2]!, handles[4]!, handles[6]!] as [DocumentPoint, DocumentPoint, DocumentPoint, DocumentPoint]
  const center = local({ x: bounds.x + bounds.width * origin.x, y: bounds.y + bounds.height * origin.y })
  const top = handles[1]!, vector = { x: top.x - center.x, y: top.y - center.y }, length = Math.hypot(vector.x, vector.y) || 1
  const rotationHandle = { x: top.x + vector.x / length * 30 / zoom, y: top.y + vector.y / length * 30 / zoom }
  return { corners, center, rotationHandle, handles }
}
function findParent(layers: readonly import('../core/model/types').Layer[], id: string, parent: string | null = null): string | null {
  for (const layer of layers) { if (layer.id === id) return parent; if (layer.kind === 'group') { const found = findParent(layer.children, id, layer.id); if (found) return found } }
  return null
}
function rotatePoint(point: DocumentPoint, angle: number): DocumentPoint {
  const cosine = Math.cos(angle); const sine = Math.sin(angle)
  return { x: point.x * cosine - point.y * sine, y: point.x * sine + point.y * cosine }
}
function distance(a: DocumentPoint, b: DocumentPoint): number { return Math.hypot(a.x - b.x, a.y - b.y) }
function pointInPolygon(point: DocumentPoint, corners: readonly DocumentPoint[]): boolean {
  let inside = false
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const a = corners[i]; const b = corners[j]
    if (!a || !b) continue
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}
