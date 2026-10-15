export interface PixelPoint { x: number; y: number }

/** Inclusive integer line; every source pixel along a pencil drag is visited once. */
export function* pencilLine(from: PixelPoint, to: PixelPoint): Generator<PixelPoint> {
  let x = from.x, y = from.y
  const dx = Math.abs(to.x - x), dy = Math.abs(to.y - y)
  const sx = x < to.x ? 1 : -1, sy = y < to.y ? 1 : -1
  let error = dx - dy
  while (true) {
    yield { x, y }
    if (x === to.x && y === to.y) break
    const doubled = 2 * error
    if (doubled > -dy) { error -= dy; x += sx }
    if (doubled < dx) { error += dx; y += sy }
  }
}

export function accumulateCoverage(previous: number, strength: number): number {
  const amount = Math.max(0, Math.min(1, strength))
  return previous + (1 - previous) * amount
}

/** Recompose from the pre-stroke pixel, so opacity caps the whole stroke, not each dab. */
export function composeStrokePixel(
  before: readonly [number, number, number, number],
  color: readonly [number, number, number],
  alpha: number,
  erase: boolean,
): [number, number, number, number] {
  const sourceAlpha = Math.max(0, Math.min(1, alpha))
  const destinationAlpha = before[3] / 255
  if (erase) return [before[0], before[1], before[2], Math.round(destinationAlpha * (1 - sourceAlpha) * 255)]
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha)
  if (outputAlpha <= 0) return [0, 0, 0, 0]
  return [
    Math.round((color[0] * sourceAlpha + before[0] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha),
    Math.round((color[1] * sourceAlpha + before[1] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha),
    Math.round((color[2] * sourceAlpha + before[2] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha),
    Math.round(outputAlpha * 255),
  ]
}
