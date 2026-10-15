import type { PixiViewportRenderer } from './PixiViewportRenderer'
import type { Subpath } from '../core/vector/PathGeometry'
import type { Point } from '../core/geometry/LayerCoordinates'

export class VectorEditingOverlay {
  private canvas = document.createElement('canvas')
  private context: CanvasRenderingContext2D
  private observer: ResizeObserver
  private paths: Subpath[] = []
  private marquee: { start: Point; end: Point } | null = null
  private guides: {
    vertical: number | null
    horizontal: number | null
    width: number
    height: number
  } | null = null
  private frame: number | null = null
  constructor(
    private host: HTMLElement,
    private renderer: PixiViewportRenderer,
  ) {
    this.canvas.className =
      'pointer-events-none absolute inset-0 z-20 h-full w-full'
    this.canvas.setAttribute('aria-hidden', 'true')
    host.appendChild(this.canvas)
    const context = this.canvas.getContext('2d')
    if (!context) throw new Error('Vector overlay requires a 2D context')
    this.context = context
    this.observer = new ResizeObserver(() => this.refresh())
    this.observer.observe(host)
  }
  set(
    paths: Subpath[],
    marquee: { start: Point; end: Point } | null = null,
    guides: typeof this.guides = null,
  ): void {
    this.paths = paths
    this.marquee = marquee
    this.guides = guides
    this.refresh()
  }
  refresh(): void {
    if (this.frame === null)
      this.frame = requestAnimationFrame(() => {
        this.frame = null
        this.draw()
      })
  }
  destroy(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    this.canvas.remove()
  }
  private draw(): void {
    const dpr = Math.min(devicePixelRatio || 1, 3),
      width = this.host.clientWidth,
      height = this.host.clientHeight
    if (
      this.canvas.width !== Math.round(width * dpr) ||
      this.canvas.height !== Math.round(height * dpr)
    ) {
      this.canvas.width = Math.round(width * dpr)
      this.canvas.height = Math.round(height * dpr)
    }
    const c = this.context
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    c.clearRect(0, 0, width, height)
    const screen = (point: Point): Point =>
      this.renderer.documentToScreen(point)
    c.strokeStyle = '#6bb7ff'
    c.lineWidth = 1
    for (const path of this.paths) {
      const first = path.anchors[0]
      if (!first) continue
      c.beginPath()
      const start = screen(first.point)
      c.moveTo(start.x, start.y)
      for (
        let i = 0;
        i < (path.closed ? path.anchors.length : path.anchors.length - 1);
        i++
      ) {
        const a = path.anchors[i]!,
          b = path.anchors[(i + 1) % path.anchors.length]!
        const p = screen(a.outgoing),
          q = screen(b.incoming),
          r = screen(b.point)
        c.bezierCurveTo(p.x, p.y, q.x, q.y, r.x, r.y)
      }
      if (path.closed) c.closePath()
      c.stroke()
      for (const anchor of path.anchors) {
        const p = screen(anchor.point)
        for (const handle of [anchor.incoming, anchor.outgoing]) {
          if (
            Math.hypot(handle.x - anchor.point.x, handle.y - anchor.point.y) <
            0.001
          )
            continue
          const h = screen(handle)
          c.beginPath()
          c.moveTo(p.x, p.y)
          c.lineTo(h.x, h.y)
          c.stroke()
          c.beginPath()
          c.arc(h.x, h.y, 3, 0, Math.PI * 2)
          c.fillStyle = '#6bb7ff'
          c.fill()
        }
        c.fillStyle = '#fff'
        c.fillRect(p.x - 3, p.y - 3, 6, 6)
        c.strokeRect(p.x - 3, p.y - 3, 6, 6)
      }
    }
    if (this.guides) {
      c.strokeStyle = '#e879f9'
      c.beginPath()
      if (this.guides.vertical !== null) {
        const a = screen({ x: this.guides.vertical, y: 0 }),
          b = screen({ x: this.guides.vertical, y: this.guides.height })
        c.moveTo(a.x, a.y)
        c.lineTo(b.x, b.y)
      }
      if (this.guides.horizontal !== null) {
        const a = screen({ x: 0, y: this.guides.horizontal }),
          b = screen({ x: this.guides.width, y: this.guides.horizontal })
        c.moveTo(a.x, a.y)
        c.lineTo(b.x, b.y)
      }
      c.stroke()
    }
    if (this.marquee) {
      const a = screen(this.marquee.start),
        b = screen(this.marquee.end)
      c.setLineDash([4, 3])
      c.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
      c.setLineDash([])
    }
  }
}
