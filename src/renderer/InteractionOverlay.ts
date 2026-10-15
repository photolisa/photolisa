import type { SpacingMeasurement } from '../core/transform/SmartGuides'
import type { DocumentRect } from '../raster/RasterStroke'
import type { PixiViewportRenderer } from './PixiViewportRenderer'
import type { SelectionMask } from '../core/selection/SelectionMask'
import { starPoints } from '../tools/shapes/AdditionalShapes'
import type { ShapeToolId } from '../tools/shapes'
import { polygonPoints } from '../tools/shapes/PolygonTool'

export type OverlayState =
  | { kind: 'none' }
  | { kind: 'corner-radius'; point: Point }
  | { kind: 'selection'; mask: SelectionMask }
  | { kind: 'selection-preview'; rect: DocumentRect; shape: 'rectangle' | 'ellipse' }
  | { kind: 'lasso-preview'; points: readonly Point[] }
  | { kind: 'move-guides'; vertical: number | null; horizontal: number | null; width: number; height: number }
  | { kind: 'crop'; rect: DocumentRect }
  | { kind: 'transform'; corners: [Point, Point, Point, Point]; rotationHandle: Point; rotationHandles?: Point[]; measurements?: SpacingMeasurement[]; radiusPoint?: Point | undefined; crop?: boolean; guides?: { vertical: number | null; horizontal: number | null } | undefined; dimensions?: { width: number; height: number } | undefined; position?: Point }
  | { kind: 'shape'; rect: DocumentRect; shape: ShapeToolId; radius: number; sides: number; innerRadius: number; customPath: string; start: Point; end: Point }

interface Point { x: number; y: number }

export class InteractionOverlay {
  readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private readonly observer: ResizeObserver
  private selectionOverlay: SelectionMask | null = null
  private state: OverlayState = { kind: 'none' }
  private width = 1
  private height = 1
  private dpr = 1

  constructor(private readonly host: HTMLElement, private readonly renderer: PixiViewportRenderer) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'pointer-events-none absolute inset-0 z-20 h-full w-full'
    this.canvas.setAttribute('aria-hidden', 'true')
    const context = this.canvas.getContext('2d')
    if (!context) throw new Error('2D canvas is unavailable for tool overlays')
    this.context = context
    host.appendChild(this.canvas)
    this.observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) this.resize(rect.width, rect.height)
    })
    this.observer.observe(host)
    this.resize(host.clientWidth, host.clientHeight)
  }

  setSelectionOverlay(mask: SelectionMask | null): void { this.selectionOverlay = mask }
  setState(state: OverlayState): void { this.state = state; this.render() }
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

  private drawSelectionMask(mask: SelectionMask): void {
    const context = this.context
      const bounds = mask.outlineBounds
      if (!bounds) return
      const zoom = this.renderer.getZoom()
      const step = Math.max(1, Math.floor(1 / Math.max(zoom, 0.01)))
      const a = this.renderer.clientToDocument(this.host.getBoundingClientRect().left, this.host.getBoundingClientRect().top)
      const b = this.renderer.clientToDocument(this.host.getBoundingClientRect().right, this.host.getBoundingClientRect().bottom)
      const left = Math.max(bounds.x, Math.floor(Math.min(a.x, b.x)) - step)
      const top = Math.max(bounds.y, Math.floor(Math.min(a.y, b.y)) - step)
      const right = Math.min(bounds.x + bounds.width, Math.ceil(Math.max(a.x, b.x)) + step)
      const bottom = Math.min(bounds.y + bounds.height, Math.ceil(Math.max(a.y, b.y)) + step)
      context.save(); context.lineWidth = 1; context.strokeStyle = '#38bdf8'; context.setLineDash([5, 4]); context.beginPath()
      for (let y = top; y < bottom; y += step) for (let x = left; x < right; x += step) {
        if (mask.coverageAt(x, y) < 128) continue
        const p = this.renderer.documentToScreen({ x, y })
        const q = this.renderer.documentToScreen({ x: x + step, y: y + step })
        if (mask.coverageAt(x, y - step) < 128) { context.moveTo(p.x, p.y); context.lineTo(q.x, p.y) }
        if (mask.coverageAt(x + step, y) < 128) { context.moveTo(q.x, p.y); context.lineTo(q.x, q.y) }
        if (mask.coverageAt(x, y + step) < 128) { context.moveTo(p.x, q.y); context.lineTo(q.x, q.y) }
        if (mask.coverageAt(x - step, y) < 128) { context.moveTo(p.x, p.y); context.lineTo(p.x, q.y) }
      }
      context.stroke(); context.restore()
  }

  private render(): void {
    const context = this.context
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    context.clearRect(0, 0, this.width, this.height)
    if (this.selectionOverlay && !this.selectionOverlay.isEmpty && this.state.kind !== 'selection') this.drawSelectionMask(this.selectionOverlay)
    if (this.state.kind === 'none') return
    if (this.state.kind === 'corner-radius') { drawHandle(context, this.renderer.documentToScreen(this.state.point), true); return }
    if (this.state.kind === 'move-guides') {
      context.save(); context.strokeStyle = '#f87171'; context.lineWidth = 1; context.setLineDash([4, 3]); context.beginPath()
      if (this.state.vertical !== null) {
        const top = this.renderer.documentToScreen({ x: this.state.vertical, y: 0 })
        const bottom = this.renderer.documentToScreen({ x: this.state.vertical, y: this.state.height })
        context.moveTo(top.x, top.y); context.lineTo(bottom.x, bottom.y)
      }
      if (this.state.horizontal !== null) {
        const left = this.renderer.documentToScreen({ x: 0, y: this.state.horizontal })
        const right = this.renderer.documentToScreen({ x: this.state.width, y: this.state.horizontal })
        context.moveTo(left.x, left.y); context.lineTo(right.x, right.y)
      }
      context.stroke(); context.restore(); return
    }
    if (this.state.kind === 'selection') { this.drawSelectionMask(this.state.mask); return }
    if (this.state.kind === 'lasso-preview') {
      context.save(); context.strokeStyle = '#38bdf8'; context.lineWidth = 1; context.setLineDash([5, 4]); context.beginPath()
      this.state.points.forEach((point, index) => { const p = this.renderer.documentToScreen(point); if (index) context.lineTo(p.x, p.y); else context.moveTo(p.x, p.y) })
      context.stroke(); context.restore(); return
    }
    if (this.state.kind === 'selection-preview') {
      const a = this.renderer.documentToScreen({ x: this.state.rect.x, y: this.state.rect.y })
      const b = this.renderer.documentToScreen({ x: this.state.rect.x + this.state.rect.width, y: this.state.rect.y + this.state.rect.height })
      context.save(); context.strokeStyle = '#38bdf8'; context.lineWidth = 1; context.setLineDash([5, 4]); context.beginPath()
      if (this.state.shape === 'ellipse') context.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2)
      else context.rect(a.x, a.y, b.x - a.x, b.y - a.y)
      context.stroke(); context.restore(); return
    }
    if (this.state.kind === 'shape') {
      const a = this.renderer.documentToScreen({ x: this.state.rect.x, y: this.state.rect.y })
      const b = this.renderer.documentToScreen({ x: this.state.rect.x + this.state.rect.width, y: this.state.rect.y + this.state.rect.height })
      const w = b.x - a.x; const h = b.y - a.y
      context.save(); context.strokeStyle = '#6bb7ff'; context.fillStyle = 'rgba(78,159,254,.15)'; context.lineWidth = 1; context.setLineDash([5, 3]); context.beginPath()
      if (this.state.shape === 'custom-shape') {
        context.save(); context.translate(a.x, a.y); context.scale(Math.max(.001, w), Math.max(.001, h)); context.fill(new Path2D(this.state.customPath)); context.restore()
        context.rect(a.x, a.y, w, h)
      } else if (this.state.shape === 'rectangle') context.rect(a.x, a.y, w, h)
      else if (this.state.shape === 'rounded-rectangle') context.roundRect(a.x, a.y, w, h, Math.min(this.state.radius * this.renderer.getZoom(), w / 2, h / 2))
      else if (this.state.shape === 'circle' || this.state.shape === 'ellipse') context.ellipse(a.x + w / 2, a.y + h / 2, this.state.shape === 'circle' ? Math.min(w, h) / 2 : w / 2, this.state.shape === 'circle' ? Math.min(w, h) / 2 : h / 2, 0, 0, Math.PI * 2)
      else if (this.state.shape === 'line' || this.state.shape === 'arrow') {
        const start = this.renderer.documentToScreen(this.state.start)
        const end = this.renderer.documentToScreen(this.state.end)
        context.moveTo(start.x, start.y); context.lineTo(end.x, end.y)
        if (this.state.shape === 'arrow') { const angle = Math.atan2(end.y - start.y, end.x - start.x); context.moveTo(end.x - Math.cos(angle - .4) * 12, end.y - Math.sin(angle - .4) * 12); context.lineTo(end.x, end.y); context.lineTo(end.x - Math.cos(angle + .4) * 12, end.y - Math.sin(angle + .4) * 12) }
      } else {
        const points = this.state.shape === 'star' ? starPoints(w, h, this.state.sides, this.state.innerRadius) : this.state.shape === 'triangle' ? [w / 2, 0, w, h, 0, h] : this.state.shape === 'polygon' ? polygonPoints(w, h, this.state.sides) : [w * .25, 0, w * .75, 0, w, h * .5, w * .75, h, w * .25, h, 0, h * .5]
        for (let i = 0; i < points.length; i += 2) {
          if (i) context.lineTo(a.x + points[i]!, a.y + points[i + 1]!)
          else context.moveTo(a.x + points[i]!, a.y + points[i + 1]!)
        }
        context.closePath()
      }
      if (this.state.shape !== 'line' && this.state.shape !== 'arrow' && this.state.shape !== 'custom-shape') context.fill()
      context.stroke(); context.setLineDash([]); context.fillStyle = '#fff'; context.font = '11px sans-serif'; context.fillText(`X ${Math.round(this.state.rect.x)} Y ${Math.round(this.state.rect.y)} · ${Math.round(this.state.rect.width)} × ${Math.round(this.state.rect.height)}`, a.x, Math.max(14, a.y - 8)); context.restore(); return
    }
    if (this.state.kind === 'crop') {
      const start = this.renderer.documentToScreen({ x: this.state.rect.x, y: this.state.rect.y })
      const end = this.renderer.documentToScreen({ x: this.state.rect.x + this.state.rect.width, y: this.state.rect.y + this.state.rect.height })
      context.fillStyle = 'rgba(0,0,0,0.55)'
      context.fillRect(0, 0, this.width, Math.max(0, start.y))
      context.fillRect(0, start.y, Math.max(0, start.x), end.y - start.y)
      context.fillRect(end.x, start.y, this.width - end.x, end.y - start.y)
      context.fillRect(0, end.y, this.width, this.height - end.y)
      context.save()
      context.strokeStyle = '#f8fafc'
      context.lineWidth = 1
      context.setLineDash([5, 4])
      context.strokeRect(Math.round(start.x) + 0.5, Math.round(start.y) + 0.5, end.x - start.x, end.y - start.y)
      context.restore()
      cropHandles(context, start, end)
      return
    }
    const corners = this.state.corners.map((point) => this.renderer.documentToScreen(point)) as [Point, Point, Point, Point]
    const rotation = this.renderer.documentToScreen(this.state.rotationHandle)
    context.strokeStyle = '#4c9ffe'
    context.lineWidth = 1.5
    context.beginPath()
    context.moveTo(corners[0].x, corners[0].y)
    corners.slice(1).forEach((point) => context.lineTo(point.x, point.y))
    context.closePath()
    context.stroke()
    context.beginPath()
    if (!this.state.rotationHandles) context.moveTo((corners[0].x + corners[1].x) / 2, (corners[0].y + corners[1].y) / 2)
    if (!this.state.rotationHandles) context.lineTo(rotation.x, rotation.y)
    context.stroke()
    context.fillStyle = '#f8fafc'; context.font = '11px sans-serif'
    const width = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y) / this.renderer.getZoom(), height = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y) / this.renderer.getZoom(), rotationAngle = Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x) * 180 / Math.PI
    const label = `${this.state.position ? `X ${this.state.position.x.toFixed(1)} Y ${this.state.position.y.toFixed(1)} · ` : ''}${width.toFixed(1)} × ${height.toFixed(1)} · ${rotationAngle.toFixed(1)}°`
    const labelWidth = context.measureText(label).width, labelX = Math.max(6, Math.min(this.width - labelWidth - 12, Math.min(...corners.map(p => p.x)))), labelY = Math.max(20, Math.min(...corners.map(p => p.y)) - 12)
    context.fillStyle = '#111827ee'; context.fillRect(labelX - 5, labelY - 13, labelWidth + 10, 20)
    context.fillStyle = '#f8fafc'; context.fillText(label, labelX, labelY)
    ;[...corners, ...corners.map((p, i) => ({ x: (p.x + corners[(i + 1) % 4]!.x) / 2, y: (p.y + corners[(i + 1) % 4]!.y) / 2 }))].forEach((point) => drawHandle(context, point, false))
    if (this.state.radiusPoint) { const p = this.renderer.documentToScreen(this.state.radiusPoint); drawHandle(context, p, true); context.fillText('Radius', p.x + 9, p.y - 7) }
    if (this.state.crop) context.fillText('Crop · drag image to reposition · Enter to finish', corners[0].x, Math.max(28, corners[0].y - 26))
    if (!this.state.crop) (this.state.rotationHandles ?? [this.state.rotationHandle]).map(p => this.renderer.documentToScreen(p)).forEach(p => drawHandle(context, p, true))
    for (const measurement of this.state.measurements ?? []) {
      const a = this.renderer.documentToScreen(measurement.from), b = this.renderer.documentToScreen(measurement.to)
      context.save(); context.strokeStyle = '#f472b6'; context.fillStyle = '#f472b6'; context.lineWidth = 1; context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y)
      const horizontal = Math.abs(a.y - b.y) < .001
      for (const p of [a, b]) { context.moveTo(p.x - (horizontal ? 0 : 3), p.y - (horizontal ? 3 : 0)); context.lineTo(p.x + (horizontal ? 0 : 3), p.y + (horizontal ? 3 : 0)) }
      context.stroke(); context.fillText(`${measurement.distance.toFixed(1)} px`, (a.x + b.x) / 2 + 4, (a.y + b.y) / 2 - 5); context.restore()
    }
    if (this.state.guides && this.state.dimensions) {
      context.save(); context.strokeStyle = '#f472b6'; context.lineWidth = 1; context.setLineDash([4, 3]); context.beginPath()
      const { vertical, horizontal } = this.state.guides, { width, height } = this.state.dimensions
      if (vertical !== null) { const a = this.renderer.documentToScreen({ x: vertical, y: 0 }), b = this.renderer.documentToScreen({ x: vertical, y: height }); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y) }
      if (horizontal !== null) { const a = this.renderer.documentToScreen({ x: 0, y: horizontal }), b = this.renderer.documentToScreen({ x: width, y: horizontal }); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y) }
      context.stroke(); context.restore()
    }
  }
}

function cropHandles(context: CanvasRenderingContext2D, start: Point, end: Point): void {
  const points = [
    start, { x: (start.x + end.x) / 2, y: start.y }, { x: end.x, y: start.y },
    { x: end.x, y: (start.y + end.y) / 2 }, end,
    { x: (start.x + end.x) / 2, y: end.y }, { x: start.x, y: end.y },
    { x: start.x, y: (start.y + end.y) / 2 },
  ]
  points.forEach((point) => drawHandle(context, point, false))
}

function drawHandle(context: CanvasRenderingContext2D, point: Point, round: boolean): void {
  context.fillStyle = '#f8fafc'
  context.strokeStyle = '#18181b'
  context.beginPath()
  if (round) context.arc(point.x, point.y, 5, 0, Math.PI * 2)
  else context.rect(point.x - 4, point.y - 4, 8, 8)
  context.fill()
  context.stroke()
}
