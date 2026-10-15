import type { EditorDocument } from '../core/model/EditorDocument'
import type { Viewport } from './Viewport'

const RULER_SIZE = 24

export class RulerOverlay {
  readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private width = 1
  private height = 1
  private dpr = 1

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'pointer-events-none absolute inset-0 z-10 h-full w-full'
    this.canvas.setAttribute('aria-hidden', 'true')
    const context = this.canvas.getContext('2d')
    if (!context) throw new Error('2D canvas is unavailable for rulers')
    this.context = context
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.dpr = Math.max(1, dpr)
    this.canvas.width = Math.round(this.width * this.dpr)
    this.canvas.height = Math.round(this.height * this.dpr)
  }

  render(viewport: Viewport, editorDocument: EditorDocument | null): void {
    const context = this.context
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    context.clearRect(0, 0, this.width, this.height)
    context.fillStyle = '#141414'
    context.fillRect(0, 0, this.width, RULER_SIZE)
    context.fillRect(0, 0, RULER_SIZE, this.height)
    context.strokeStyle = '#1e1e1e'
    context.beginPath()
    context.moveTo(0, RULER_SIZE + 0.5)
    context.lineTo(this.width, RULER_SIZE + 0.5)
    context.moveTo(RULER_SIZE + 0.5, 0)
    context.lineTo(RULER_SIZE + 0.5, this.height)
    context.stroke()
    if (!editorDocument) return
    const step = chooseStep(viewport.zoom)
    this.drawHorizontal(viewport, step)
    this.drawVertical(viewport, step)
    context.fillStyle = '#141414'
    context.fillRect(0, 0, RULER_SIZE, RULER_SIZE)
  }

  private drawHorizontal(viewport: Viewport, step: number): void {
    const context = this.context
    const from = viewport.screenToDocument({ x: RULER_SIZE, y: 0 }).x
    const to = viewport.screenToDocument({ x: this.width, y: 0 }).x
    const start = Math.floor(from / step) * step
    context.font = '9px ui-sans-serif, system-ui, sans-serif'
    context.fillStyle = '#9ca3af'
    context.strokeStyle = '#6b7280'
    context.textBaseline = 'top'
    for (let value = start; value <= to; value += step) {
      const x = Math.round(viewport.documentToScreen({ x: value, y: 0 }).x) + 0.5
      context.beginPath()
      context.moveTo(x, RULER_SIZE)
      context.lineTo(x, 15)
      context.stroke()
      context.fillText(formatUnit(value), x + 3, 3)
    }
  }

  private drawVertical(viewport: Viewport, step: number): void {
    const context = this.context
    const from = viewport.screenToDocument({ x: 0, y: RULER_SIZE }).y
    const to = viewport.screenToDocument({ x: 0, y: this.height }).y
    const start = Math.floor(from / step) * step
    context.font = '9px ui-sans-serif, system-ui, sans-serif'
    context.fillStyle = '#9ca3af'
    context.strokeStyle = '#6b7280'
    context.textBaseline = 'top'
    for (let value = start; value <= to; value += step) {
      const y = Math.round(viewport.documentToScreen({ x: 0, y: value }).y) + 0.5
      context.beginPath()
      context.moveTo(RULER_SIZE, y)
      context.lineTo(15, y)
      context.stroke()
      context.save()
      context.translate(3, y + 3)
      context.rotate(-Math.PI / 2)
      context.fillText(formatUnit(value), 0, 0)
      context.restore()
    }
  }
}

function chooseStep(zoom: number): number {
  const minimumDocumentStep = 64 / zoom
  const magnitude = 10 ** Math.floor(Math.log10(minimumDocumentStep))
  for (const multiplier of [1, 2, 5, 10]) {
    const candidate = multiplier * magnitude
    if (candidate >= minimumDocumentStep) return candidate
  }
  return magnitude * 10
}

function formatUnit(value: number): string {
  return Math.abs(value) >= 1000 ? `${Math.round(value / 100) / 10}k` : `${Math.round(value)}`
}
