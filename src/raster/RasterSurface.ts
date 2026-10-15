export interface RasterSurfaceOptions {
  width: number
  height: number
  background: 'transparent' | 'white'
}

export class RasterSurface {
  readonly canvas: HTMLCanvasElement
  readonly context: CanvasRenderingContext2D

  private constructor(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
    this.canvas = canvas
    this.context = context
  }

  static create(options: RasterSurfaceOptions): RasterSurface {
    const canvas = document.createElement('canvas')
    canvas.width = options.width
    canvas.height = options.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('2D canvas is unavailable')
    if (options.background === 'white') {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
    return new RasterSurface(canvas, context)
  }

  readPixels(): ImageData {
    return this.context.getImageData(0, 0, this.canvas.width, this.canvas.height)
  }
}
