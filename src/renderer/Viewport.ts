export interface ScreenPoint { x: number; y: number }
export interface DocumentPoint { x: number; y: number }
export interface ViewportSize { width: number; height: number }
export interface DocumentSize { width: number; height: number }

export class Viewport {
  static readonly MIN_ZOOM = 0.01
  static readonly MAX_ZOOM = 32

  private screenSize: ViewportSize = { width: 1, height: 1 }
  private documentSize: DocumentSize | null = null
  private _zoom = 1
  private _origin: ScreenPoint = { x: 0, y: 0 }

  get zoom(): number { return this._zoom }
  get origin(): Readonly<ScreenPoint> { return this._origin }

  setDocument(size: DocumentSize | null): void {
    this.documentSize = size
    if (size) this.fitToScreen()
  }

  restoreView(zoom: number, center: DocumentPoint): void {
    this._zoom = Viewport.clampZoom(zoom)
    this._origin = {
      x: this.screenSize.width / 2 - center.x * this._zoom,
      y: this.screenSize.height / 2 - center.y * this._zoom,
    }
  }

  getCenter(): DocumentPoint { return this.screenToDocument({ x: this.screenSize.width / 2, y: this.screenSize.height / 2 }) }

  updateDocumentSize(size: DocumentSize): void { this.documentSize = size }

  resize(size: ViewportSize): void {
    const previousCenter = { x: this.screenSize.width / 2, y: this.screenSize.height / 2 }
    const documentCenter = this.screenToDocument(previousCenter)
    this.screenSize = { width: Math.max(1, size.width), height: Math.max(1, size.height) }
    if (!this.documentSize) return
    this._origin = {
      x: this.screenSize.width / 2 - documentCenter.x * this._zoom,
      y: this.screenSize.height / 2 - documentCenter.y * this._zoom,
    }
  }

  screenToDocument(point: ScreenPoint): DocumentPoint {
    return { x: (point.x - this._origin.x) / this._zoom, y: (point.y - this._origin.y) / this._zoom }
  }

  documentToScreen(point: DocumentPoint): ScreenPoint {
    return { x: this._origin.x + point.x * this._zoom, y: this._origin.y + point.y * this._zoom }
  }

  setZoomAt(nextZoom: number, anchor: ScreenPoint): void {
    const documentAnchor = this.screenToDocument(anchor)
    this._zoom = Viewport.clampZoom(nextZoom)
    this._origin = {
      x: anchor.x - documentAnchor.x * this._zoom,
      y: anchor.y - documentAnchor.y * this._zoom,
    }
  }

  panBy(delta: ScreenPoint): void {
    this._origin = { x: this._origin.x + delta.x, y: this._origin.y + delta.y }
  }

  fitToScreen(padding = 56): void {
    if (!this.documentSize) return
    const availableWidth = Math.max(1, this.screenSize.width - padding * 2)
    const availableHeight = Math.max(1, this.screenSize.height - padding * 2)
    this._zoom = Viewport.clampZoom(Math.min(availableWidth / this.documentSize.width, availableHeight / this.documentSize.height, 1))
    this.centerDocument()
  }

  actualSize(): void {
    this._zoom = 1
    this.centerDocument()
  }

  reset(): void {
    this.fitToScreen()
  }

  private centerDocument(): void {
    if (!this.documentSize) return
    this._origin = {
      x: (this.screenSize.width - this.documentSize.width * this._zoom) / 2,
      y: (this.screenSize.height - this.documentSize.height * this._zoom) / 2,
    }
  }

  private static clampZoom(value: number): number {
    return Math.min(Viewport.MAX_ZOOM, Math.max(Viewport.MIN_ZOOM, value))
  }
}
