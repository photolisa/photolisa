import type { StrokeMode } from '../raster/RasterStroke'
import type { AffineMatrix } from '../core/model/types'
import { invertAffine, transformPoint } from '../core/geometry/LayerCoordinates'
import type { PixiViewportRenderer } from './PixiViewportRenderer'

interface DocumentSize { width: number; height: number }
interface CursorState { x: number; y: number; mode: StrokeMode; diameter: number }

/** Client-only overlay; cursor and optional pixel grid never enter document pixels. */
export class DrawingOverlay {
  readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private readonly observer: ResizeObserver
  private width = 1
  private height = 1
  private dpr = 1
  private cursor: CursorState | null = null
  private gridEnabled = false

  constructor(
    private readonly host: HTMLElement,
    private readonly renderer: PixiViewportRenderer,
    private readonly getDocumentSize: () => DocumentSize | null,
    private readonly getActiveMatrix: () => AffineMatrix | null,
  ) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'pointer-events-none absolute inset-0 z-20 h-full w-full'
    this.canvas.setAttribute('aria-hidden', 'true')
    const context = this.canvas.getContext('2d')
    if (!context) throw new Error('2D canvas is unavailable for drawing overlays')
    this.context = context
    host.appendChild(this.canvas)
    this.observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) this.resize(rect.width, rect.height)
    })
    this.observer.observe(host)
    this.resize(host.clientWidth, host.clientHeight)
  }

  setGridEnabled(enabled: boolean): void {
    if (this.gridEnabled === enabled) return
    this.gridEnabled = enabled
    this.render()
  }
  setCursor(clientX: number, clientY: number, mode: StrokeMode, diameter: number): void {
    const rect = this.host.getBoundingClientRect()
    this.cursor = { x: clientX - rect.left, y: clientY - rect.top, mode, diameter }
    this.render()
  }
  clearCursor(): void { if (this.cursor) { this.cursor = null; this.render() } }
  refresh(): void { this.render() }
  destroy(): void { this.observer.disconnect(); this.canvas.remove() }

  private resize(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.dpr = Math.min(globalThis.devicePixelRatio || 1, 2)
    this.canvas.width = Math.round(this.width * this.dpr)
    this.canvas.height = Math.round(this.height * this.dpr)
    this.render()
  }

  private render(): void {
    const context = this.context
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    context.clearRect(0, 0, this.width, this.height)
    const size = this.getDocumentSize()
    const zoom = this.renderer.getZoom()
    if (size && this.gridEnabled && zoom >= 4) this.drawGrid(size, zoom)
    if (!this.cursor || !size) return
    const pointer = this.renderer.clientToDocument(
      this.host.getBoundingClientRect().left + this.cursor.x,
      this.host.getBoundingClientRect().top + this.cursor.y,
    )
    if (pointer.x < 0 || pointer.y < 0 || pointer.x >= size.width || pointer.y >= size.height) return
    const matrix = this.getActiveMatrix()
    context.save()
    context.strokeStyle = '#111827'
    context.lineWidth = 3
    if (this.cursor.mode === 'pencil') {
      let local = pointer
      if (matrix) {
        try { local = transformPoint(invertAffine(matrix), pointer) }
        catch { context.restore(); return }
      }
      const side = Math.max(1, Math.round(this.cursor.diameter))
      const x = Math.floor(local.x) - Math.floor((side - 1) / 2)
      const y = Math.floor(local.y) - Math.floor((side - 1) / 2)
      const corners = [{ x, y }, { x: x + side, y }, { x: x + side, y: y + side }, { x, y: y + side }]
        .map((corner) => this.renderer.documentToScreen(matrix ? transformPoint(matrix, corner) : corner))
      const first = corners[0]
      if (!first) { context.restore(); return }
      context.beginPath()
      context.moveTo(first.x, first.y)
      for (const corner of corners.slice(1)) context.lineTo(corner.x, corner.y)
      context.closePath()
      context.stroke()
      context.strokeStyle = '#f8fafc'
      context.lineWidth = 1
      context.stroke()
    } else {
      const strokeScale = matrix ? Math.max(0.01, zoom * Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]))) : 1
      if (matrix) {
        context.translate(this.cursor.x, this.cursor.y)
        context.transform(matrix[0] * zoom, matrix[1] * zoom, matrix[2] * zoom, matrix[3] * zoom, 0, 0)
      }
      context.beginPath()
      context.arc(matrix ? 0 : this.cursor.x, matrix ? 0 : this.cursor.y,
        Math.max(0.5, this.cursor.diameter * (matrix ? 1 : zoom) / 2), 0, Math.PI * 2)
      context.lineWidth = 3 / strokeScale
      context.stroke()
      context.strokeStyle = '#f8fafc'
      context.lineWidth = 1 / strokeScale
      context.stroke()
    }
    context.restore()
  }

  private drawGrid(size: DocumentSize, zoom: number): void {
    const context = this.context
    const origin = this.renderer.getViewState().origin
    const minX = Math.max(0, Math.ceil(-origin.x / zoom))
    const maxX = Math.min(size.width, Math.floor((this.width - origin.x) / zoom))
    const minY = Math.max(0, Math.ceil(-origin.y / zoom))
    const maxY = Math.min(size.height, Math.floor((this.height - origin.y) / zoom))
    if (maxX - minX > 600 || maxY - minY > 600) return
    const left = Math.max(0, origin.x), right = Math.min(this.width, origin.x + size.width * zoom)
    const top = Math.max(0, origin.y), bottom = Math.min(this.height, origin.y + size.height * zoom)
    context.save()
    context.strokeStyle = 'rgba(0,0,0,0.3)'
    context.lineWidth = 1
    context.beginPath()
    for (let x = minX; x <= maxX; x++) {
      const screenX = Math.round(origin.x + x * zoom) + 0.5
      context.moveTo(screenX, top); context.lineTo(screenX, bottom)
    }
    for (let y = minY; y <= maxY; y++) {
      const screenY = Math.round(origin.y + y * zoom) + 0.5
      context.moveTo(left, screenY); context.lineTo(right, screenY)
    }
    context.stroke()
    context.restore()
  }
}
