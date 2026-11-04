import type { BrushDynamics } from './BrushPresets'

export interface Dab { x: number; y: number; pressure: number; index: number; seed: number }
export type PaintPixel = (x: number, y: number, coverage: number) => void

/** Stable integer noise keeps paper grain fixed and particle strokes reproducible. */
export function brushNoise(x: number, y: number, seed: number): number {
  let hash = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ seed
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177)
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296
}
export function dabSpacing(brush: BrushDynamics): number {
  return Math.max(.25, brush.diameter * brush.spacing)
}
export function dashVisible(brush: BrushDynamics, distance: number): boolean {
  if (brush.preset !== 'dashed') return true
  const length = brush.dashLength * brush.diameter
  return distance % (length + brush.dashGap * brush.diameter) < length
}

/** Browser-independent tip rasterization. All marks pass through the session compositor. */
export function paintBrushDab(brush: BrushDynamics, dab: Dab, width: number, height: number, paint: PaintPixel): void {
  const pressure = Math.max(.01, Math.min(1, dab.pressure))
  const radius = Math.max(.5, brush.diameter * (brush.pressureSize ? Math.max(.1, pressure) : 1) / 2)
  const flow = brush.flow * (brush.pressureFlow ? pressure : 1)
  if (flow <= 0) return
  const x = dab.x + (brushNoise(dab.index, 1, dab.seed) - .5) * brush.scatter * radius
  const y = dab.y + (brushNoise(dab.index, 2, dab.seed) - .5) * brush.scatter * radius
  const angle = brush.angle * Math.PI / 180
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const raster = (cx: number, cy: number, r: number, sample: (dx: number, dy: number, px: number, py: number) => number) => {
    const left = Math.max(0, Math.floor(cx - r - 1)), right = Math.min(width - 1, Math.ceil(cx + r + 1))
    const top = Math.max(0, Math.floor(cy - r - 1)), bottom = Math.min(height - 1, Math.ceil(cy + r + 1))
    for (let py = top; py <= bottom; py++) for (let px = left; px <= right; px++) {
      const amount = sample(px + .5 - cx, py + .5 - cy, px, py)
      if (amount > 0) paint(px, py, Math.min(1, amount * flow))
    }
  }
  if (brush.tip === 'pixel') {
    const size = Math.max(1, Math.round(radius * 2))
    const left = Math.floor(dab.x) - Math.floor((size - 1) / 2), top = Math.floor(dab.y) - Math.floor((size - 1) / 2)
    for (let py = Math.max(0, top); py < Math.min(height, top + size); py++)
      for (let px = Math.max(0, left); px < Math.min(width, left + size); px++) paint(px, py, flow)
    return
  }
  if (brush.tip === 'spray' || brush.tip === 'splatter') {
    const count = brush.tip === 'spray' ? 48 : 13
    for (let i = 0; i < count; i++) {
      const key = dab.index * 97 + i
      const theta = brushNoise(key, 3, dab.seed) * Math.PI * 2
      const spread = Math.sqrt(brushNoise(key, 4, dab.seed)) * radius
      const dot = brush.tip === 'spray' ? Math.max(.55, radius * .018) : Math.max(.7, radius * (.025 + .12 * brushNoise(key, 5, dab.seed) ** 3))
      raster(x + Math.cos(theta) * spread, y + Math.sin(theta) * spread, dot,
        (dx, dy) => Math.max(0, Math.min(1, dot + .5 - Math.hypot(dx, dy))))
    }
    return
  }
  raster(x, y, radius, (dx, dy, px, py) => {
    const u = dx * cos + dy * sin, v = (-dx * sin + dy * cos) / brush.roundness
    const distance = Math.hypot(u, v)
    const edge = Math.min(1, Math.max(0, radius + .5 - distance))
    if (edge === 0) return 0
    const inner = brush.hardness * radius
    let amount = edge * (distance <= inner ? 1 : Math.max(0, (radius + .5 - distance) / (radius + .5 - inner)))
    const grain = brushNoise(px, py, dab.seed)
    let texture = 1
    switch (brush.tip) {
      case 'graphite': texture = grain > .35 ? .3 + grain * .7 : 0; break
      case 'charcoal': texture = brushNoise(Math.floor(px / 2), Math.floor(py / 2), dab.seed) > .35 ? grain : 0; break
      case 'chalk': texture = grain > .3 ? 1 : 0; break
      case 'wax': texture = grain > .23 ? .45 + .55 * Math.abs(Math.sin(px * .7 + py * 1.3)) : 0; break
      case 'bristle': texture = (.15 + .85 * Math.abs(Math.sin((-px * sin + py * cos) * 1.7))) ** 3; break
      case 'watercolor': {
        const normalized = distance / radius
        // Pigment pools near the wet edge; low flow leaves a translucent wash.
        amount = edge * (.22 + .65 * Math.exp(-(((normalized - .8) / .16) ** 2)))
        texture = .35 + grain * .65
        break
      }
    }
    return amount * (1 - brush.texture + brush.texture * texture)
  })
}
