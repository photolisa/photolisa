import type { Point } from '../core/geometry/LayerCoordinates'
import type { AlignmentGuide } from '../core/transform/SmartSnapping'
import type { SpacingMeasurement } from '../core/transform/SmartGuides'

export interface MoveGuides {
  vertical: number | null
  horizontal: number | null
  lines?: readonly AlignmentGuide[]
}

/** CSS-pixel drawing; the owning overlay applies the device-pixel-ratio transform. */
export function drawSmartGuides(
  context: CanvasRenderingContext2D,
  guides: MoveGuides | undefined,
  measurements: readonly SpacingMeasurement[],
  dimensions: { width: number; height: number } | undefined,
  screen: (point: Point) => Point,
): void {
  context.save()
  const lines: AlignmentGuide[] = [...(guides?.lines ?? [])]
  if (!guides?.lines && guides && dimensions) {
    if (guides.vertical !== null)
      lines.push({
        kind: 'canvas',
        from: { x: guides.vertical, y: 0 },
        to: { x: guides.vertical, y: dimensions.height },
      })
    if (guides.horizontal !== null)
      lines.push({
        kind: 'canvas',
        from: { x: 0, y: guides.horizontal },
        to: { x: dimensions.width, y: guides.horizontal },
      })
  }
  context.strokeStyle = '#f472b6'
  context.lineWidth = 1
  for (const line of lines) {
    const a = screen(line.from),
      b = screen(line.to)
    context.setLineDash(
      line.kind === 'center' || line.kind === 'canvas' ? [4, 3] : [],
    )
    context.beginPath()
    context.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5)
    context.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5)
    context.stroke()
  }
  context.setLineDash([])
  context.font = '11px sans-serif'
  for (const measurement of measurements) {
    const a = screen(measurement.from),
      b = screen(measurement.to)
    context.lineWidth = measurement.equal ? 2 : 1
    context.beginPath()
    context.moveTo(a.x, a.y)
    context.lineTo(b.x, b.y)
    const horizontal = Math.abs(a.y - b.y) < 0.001
    for (const p of [a, b]) {
      context.moveTo(p.x - (horizontal ? 0 : 3), p.y - (horizontal ? 3 : 0))
      context.lineTo(p.x + (horizontal ? 0 : 3), p.y + (horizontal ? 3 : 0))
    }
    context.stroke()
    const distance = Number(measurement.distance.toFixed(2))
    const label = `${measurement.equal ? '= ' : ''}${distance} px`
    const width = context.measureText(label).width
    const x = (a.x + b.x) / 2 + (horizontal ? -width / 2 : 6)
    const y = (a.y + b.y) / 2 - 6
    context.fillStyle = '#18181bee'
    context.fillRect(x - 3, y - 11, width + 6, 15)
    context.fillStyle = '#f472b6'
    context.fillText(label, x, y)
  }
  context.restore()
}
