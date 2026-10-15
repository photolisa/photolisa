export interface SelectionRect { x: number; y: number; width: number; height: number }
export interface SelectionPoint { x: number; y: number }
export type SelectionOperation = 'new' | 'add' | 'subtract' | 'intersect'

/** Immutable document-space 8-bit coverage. Outside the stored bounds, pixels use defaultCoverage. */
export class SelectionMask {
  private readonly hasCoverage: boolean
  private constructor(
    readonly documentWidth: number,
    readonly documentHeight: number,
    private readonly bounds: SelectionRect,
    private readonly pixels: Uint8Array,
    private readonly defaultCoverage: 0 | 255,
  ) { this.hasCoverage = defaultCoverage === 255 || pixels.some((value) => value > 0) }

  static empty(width: number, height: number): SelectionMask { validateSize(width, height); return new SelectionMask(width, height, { x: 0, y: 0, width: 0, height: 0 }, new Uint8Array(), 0) }
  static all(width: number, height: number): SelectionMask { validateSize(width, height); return new SelectionMask(width, height, { x: 0, y: 0, width: 0, height: 0 }, new Uint8Array(), 255) }

  static rectangle(width: number, height: number, rect: SelectionRect): SelectionMask {
    validateSize(width, height)
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width < 0 || rect.height < 0) throw new Error('Invalid selection rectangle')
    const left = Math.max(0, Math.floor(rect.x)), top = Math.max(0, Math.floor(rect.y))
    const right = Math.min(width, Math.ceil(rect.x + rect.width)), bottom = Math.min(height, Math.ceil(rect.y + rect.height))
    if (right <= left || bottom <= top) return SelectionMask.empty(width, height)
    const data = new Uint8Array((right - left) * (bottom - top))
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const coverage = Math.max(0, Math.min(x + 1, rect.x + rect.width) - Math.max(x, rect.x))
        * Math.max(0, Math.min(y + 1, rect.y + rect.height) - Math.max(y, rect.y))
      data[(y - top) * (right - left) + x - left] = Math.round(coverage * 255)
    }
    return new SelectionMask(width, height, { x: left, y: top, width: right - left, height: bottom - top }, data, 0)
  }

  /** Four subpixel samples retain useful coverage at curved and diagonal edges. */
  static ellipse(width: number, height: number, rect: SelectionRect): SelectionMask {
    return SelectionMask.rasterize(width, height, rect, (x, y) => {
      const rx = rect.width / 2, ry = rect.height / 2
      if (rx <= 0 || ry <= 0) return false
      const dx = (x - rect.x - rx) / rx, dy = (y - rect.y - ry) / ry
      return dx * dx + dy * dy <= 1
    })
  }

  static polygon(width: number, height: number, points: readonly SelectionPoint[]): SelectionMask {
    validateSize(width, height)
    if (points.length < 3 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return SelectionMask.empty(width, height)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const point of points) { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y) }
    const left = Math.max(0, Math.floor(minX)), top = Math.max(0, Math.floor(minY))
    const right = Math.min(width, Math.ceil(maxX)), bottom = Math.min(height, Math.ceil(maxY))
    if (right <= left || bottom <= top) return SelectionMask.empty(width, height)
    const rowWidth = right - left
    const data = new Uint8Array(rowWidth * (bottom - top))
    for (let y = top; y < bottom; y++) {
      const upper = polygonIntersections(points, y + 0.25)
      const lower = polygonIntersections(points, y + 0.75)
      for (let x = left; x < right; x++) {
        const count = Number(insideIntersections(upper, x + 0.25)) + Number(insideIntersections(upper, x + 0.75))
          + Number(insideIntersections(lower, x + 0.25)) + Number(insideIntersections(lower, x + 0.75))
        data[(y - top) * rowWidth + x - left] = Math.round(count * 255 / 4)
      }
    }
    return new SelectionMask(width, height, { x: left, y: top, width: rowWidth, height: bottom - top }, data, 0)
  }

  private static rasterize(width: number, height: number, rect: SelectionRect, contains: (x: number, y: number) => boolean): SelectionMask {
    validateSize(width, height)
    const left = Math.max(0, Math.floor(rect.x)), top = Math.max(0, Math.floor(rect.y))
    const right = Math.min(width, Math.ceil(rect.x + rect.width)), bottom = Math.min(height, Math.ceil(rect.y + rect.height))
    if (right <= left || bottom <= top) return SelectionMask.empty(width, height)
    const data = new Uint8Array((right - left) * (bottom - top))
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      let count = 0
      for (const dy of [0.25, 0.75]) for (const dx of [0.25, 0.75]) if (contains(x + dx, y + dy)) count++
      data[(y - top) * (right - left) + x - left] = Math.round(count * 255 / 4)
    }
    return new SelectionMask(width, height, { x: left, y: top, width: right - left, height: bottom - top }, data, 0)
  }

  feather(radius: number): SelectionMask {
    if (!Number.isFinite(radius) || radius < 0 || radius > 256) throw new Error('Feather radius must be between 0 and 256 pixels')
    const r = Math.ceil(radius)
    if (!r || this.isEmpty) return this
    const source = this.outlineBounds!
    const left = Math.max(0, source.x - r), top = Math.max(0, source.y - r)
    const right = Math.min(this.documentWidth, source.x + source.width + r)
    const bottom = Math.min(this.documentHeight, source.y + source.height + r)
    const width = right - left, height = bottom - top
    const horizontal = new Float32Array(width * height)
    const output = new Uint8Array(width * height)
    const span = r * 2 + 1
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      let sum = 0
      for (let dx = -r; dx <= r; dx++) sum += this.coverageAt(x + dx, y)
      horizontal[(y - top) * width + x - left] = sum / span
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = 0
      for (let dy = -r; dy <= r; dy++) if (y + dy >= 0 && y + dy < height) sum += horizontal[(y + dy) * width + x]!
      output[y * width + x] = Math.round(sum / span)
    }
    return new SelectionMask(this.documentWidth, this.documentHeight, { x: left, y: top, width, height }, output, 0)
  }

  get memoryCost(): number { return this.pixels.byteLength + 128 }
  get isEmpty(): boolean { return !this.hasCoverage }
  get outlineBounds(): SelectionRect | null {
    if (this.defaultCoverage === 255) return { x: 0, y: 0, width: this.documentWidth, height: this.documentHeight }
    return this.isEmpty ? null : { ...this.bounds }
  }

  coverageAt(x: number, y: number): number {
    const column = Math.floor(x), row = Math.floor(y)
    if (column < 0 || row < 0 || column >= this.documentWidth || row >= this.documentHeight) return 0
    if (column < this.bounds.x || row < this.bounds.y || column >= this.bounds.x + this.bounds.width || row >= this.bounds.y + this.bounds.height) return this.defaultCoverage
    return this.pixels[(row - this.bounds.y) * this.bounds.width + column - this.bounds.x] ?? this.defaultCoverage
  }

  invert(): SelectionMask {
    const data = this.pixels.map((coverage) => 255 - coverage)
    return new SelectionMask(this.documentWidth, this.documentHeight, this.bounds, data, this.defaultCoverage === 0 ? 255 : 0)
  }

  combine(other: SelectionMask, operation: SelectionOperation): SelectionMask {
    if (this.documentWidth !== other.documentWidth || this.documentHeight !== other.documentHeight) throw new Error('Selection masks have different document dimensions')
    if (operation === 'new') return other
    const bounds = unionBounds(this.bounds, other.bounds)
    const combine = (a: number, b: number): number => operation === 'add' ? Math.max(a, b)
      : operation === 'subtract' ? Math.round(a * (255 - b) / 255)
        : Math.round(a * b / 255)
    const defaultValue = combine(this.defaultCoverage, other.defaultCoverage) as 0 | 255
    if (!bounds.width || !bounds.height) return defaultValue === 255 ? SelectionMask.all(this.documentWidth, this.documentHeight) : SelectionMask.empty(this.documentWidth, this.documentHeight)
    const data = new Uint8Array(bounds.width * bounds.height)
    for (let y = bounds.y; y < bounds.y + bounds.height; y++) for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      data[(y - bounds.y) * bounds.width + x - bounds.x] = combine(this.coverageAt(x, y), other.coverageAt(x, y))
    }
    return new SelectionMask(this.documentWidth, this.documentHeight, bounds, data, defaultValue)
  }
}

function polygonIntersections(points: readonly SelectionPoint[], y: number): number[] {
  const crossings: number[] = []
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!, b = points[j]!
    if ((a.y > y) !== (b.y > y)) crossings.push(a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y))
  }
  return crossings.sort((a, b) => a - b)
}

function insideIntersections(crossings: readonly number[], x: number): boolean {
  let low = 0, high = crossings.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (crossings[middle]! <= x) low = middle + 1
    else high = middle
  }
  return (low & 1) === 1
}

function unionBounds(a: SelectionRect, b: SelectionRect): SelectionRect {
  if (!a.width || !a.height) return { ...b }
  if (!b.width || !b.height) return { ...a }
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}

function validateSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 67_108_864) throw new Error('Invalid selection document dimensions')
}
