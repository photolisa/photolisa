/** Brush definitions are data; adding a preset does not change gesture/history ownership. */
export type BrushPresetId = 'hard-round' | 'soft-round' | 'pencil' | 'pen' | 'marker' | 'airbrush'
  | 'watercolor' | 'oil-paint' | 'charcoal' | 'chalk' | 'crayon' | 'ink-brush'
  | 'spray-paint' | 'splatter' | 'dotted' | 'dashed' | 'calligraphy' | 'pixel'
export type BrushTip = 'round' | 'graphite' | 'watercolor' | 'bristle' | 'charcoal' | 'chalk' | 'wax' | 'spray' | 'splatter' | 'pixel'
export interface BrushDynamics {
  preset: BrushPresetId
  tip: BrushTip
  diameter: number
  hardness: number
  opacity: number
  flow: number
  spacing: number
  texture: number
  scatter: number
  angle: number
  roundness: number
  pressureSize: boolean
  pressureFlow: boolean
  dashLength: number
  dashGap: number
}
export interface BrushPreset {
  id: BrushPresetId
  name: string
  group: 'Basic' | 'Artistic' | 'Special'
  description: string
  settings: BrushDynamics
}
const defaults: BrushDynamics = {
  preset: 'hard-round', tip: 'round', diameter: 32, hardness: 1, opacity: 1, flow: 1,
  spacing: .12, texture: 0, scatter: 0, angle: 0, roundness: 1,
  pressureSize: true, pressureFlow: false, dashLength: 2, dashGap: 1,
}
function preset(id: BrushPresetId, name: string, group: BrushPreset['group'], description: string, settings: Partial<BrushDynamics> = {}): BrushPreset {
  return { id, name, group, description, settings: { ...defaults, ...settings, preset: id } }
}
const hardRound = preset('hard-round', 'Hard Round', 'Basic', 'Solid paint with crisp circular edges.')
export const BRUSH_PRESETS: readonly BrushPreset[] = [
  hardRound,
  preset('soft-round', 'Soft Round', 'Basic', 'Feathered edges for gentle blending.', { hardness: 0, flow: .25 }),
  preset('pencil', 'Pencil', 'Basic', 'Fine graphite with paper grain.', { tip: 'graphite', diameter: 3, texture: .75, flow: .55 }),
  preset('pen', 'Pen', 'Basic', 'Precise, continuous ink at a constant width.', { diameter: 4, spacing: .08, pressureSize: false }),
  preset('marker', 'Marker', 'Basic', 'Smooth translucent ink with a broad tip.', { opacity: .4, roundness: .65, angle: 30, pressureSize: false }),
  preset('airbrush', 'Airbrush', 'Basic', 'Soft spray builds gradually while held down.', { diameter: 64, hardness: 0, flow: .035, spacing: .08, pressureFlow: true }),
  preset('watercolor', 'Watercolor', 'Artistic', 'Translucent washes with pooled edges and paper granulation.', { tip: 'watercolor', diameter: 48, hardness: .1, opacity: .35, flow: .14, texture: .6, pressureFlow: true }),
  preset('oil-paint', 'Oil Paint', 'Artistic', 'Dense bristles leave ridged paint tracks.', { tip: 'bristle', diameter: 36, hardness: .9, flow: .7, texture: .85, roundness: .65, angle: 25 }),
  preset('charcoal', 'Charcoal', 'Artistic', 'Soft broken edges and coarse charcoal grain.', { tip: 'charcoal', diameter: 24, hardness: .25, texture: .9, flow: .4 }),
  preset('chalk', 'Chalk', 'Artistic', 'Dry, porous marks with a blunt edge.', { tip: 'chalk', diameter: 20, hardness: .95, texture: .85, flow: .6 }),
  preset('crayon', 'Crayon', 'Artistic', 'Waxy ribbons catch on the paper texture.', { tip: 'wax', diameter: 16, hardness: .8, texture: .8, flow: .65 }),
  preset('ink-brush', 'Ink Brush', 'Artistic', 'Expressive tapered ink; pen pressure controls width and flow.', { diameter: 28, spacing: .06, roundness: .7, angle: 45, pressureFlow: true }),
  preset('spray-paint', 'Spray Paint', 'Special', 'Fine randomized particles; hold to build coverage.', { tip: 'spray', diameter: 64, flow: .35, spacing: .15, scatter: .2 }),
  preset('splatter', 'Splatter', 'Special', 'Clusters of irregular paint droplets.', { tip: 'splatter', diameter: 64, spacing: .8, scatter: .45 }),
  preset('dotted', 'Dotted', 'Special', 'Circular marks at regular intervals.', { diameter: 12, spacing: 1.8, pressureSize: false }),
  preset('dashed', 'Dashed', 'Special', 'Painted dashes with adjustable length and gap.', { diameter: 8, spacing: .08, pressureSize: false }),
  preset('calligraphy', 'Calligraphy', 'Special', 'An angled flat nib varies width with stroke direction.', { diameter: 32, roundness: .18, angle: 45, spacing: .05 }),
  preset('pixel', 'Pixel Brush', 'Special', 'Integer-aligned square pixels without antialiasing.', { tip: 'pixel', diameter: 1, spacing: .1, pressureSize: false }),
]
export function brushPreset(id: unknown): BrushPreset {
  return BRUSH_PRESETS.find(item => item.id === id) ?? hardRound
}
const finite = (value: number | undefined, fallback: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value ?? fallback)) : fallback
/** Snapshot and bound numeric settings before allocating a surface or walking dabs. */
export function resolveBrush(settings: Partial<BrushDynamics> & { diameter: number }): BrushDynamics {
  const base = brushPreset(settings.preset).settings
  return {
    ...base, preset: base.preset,
    tip: settings.tip && BRUSH_PRESETS.some(item => item.settings.tip === settings.tip) ? settings.tip : base.tip,
    diameter: finite(settings.diameter, base.diameter, 1, 500),
    hardness: finite(settings.hardness, base.hardness, 0, 1),
    opacity: finite(settings.opacity, base.opacity, 0, 1),
    flow: finite(settings.flow, base.flow, 0, 1),
    spacing: finite(settings.spacing, base.spacing, .01, 4),
    texture: finite(settings.texture, base.texture, 0, 1),
    scatter: finite(settings.scatter, base.scatter, 0, 1),
    angle: finite(settings.angle, base.angle, -180, 180),
    roundness: finite(settings.roundness, base.roundness, .05, 1),
    pressureSize: settings.pressureSize ?? base.pressureSize,
    pressureFlow: settings.pressureFlow ?? base.pressureFlow,
    dashLength: finite(settings.dashLength, base.dashLength, .25, 20),
    dashGap: finite(settings.dashGap, base.dashGap, .25, 20),
  }
}
