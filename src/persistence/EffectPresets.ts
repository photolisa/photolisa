import { filterRegistry, cloneAdjustment } from '../core/filters/FilterRegistry'
import type { LayerAdjustment } from '../core/filters/types'
export interface EffectPreset { id: string; name: string; effects: LayerAdjustment[] }
const KEY = 'photolisa.effects.presets.v1'
export function loadEffectPresets(): EffectPreset[] {
  const text = localStorage.getItem(KEY)
  if (!text) return []
  if (text.length > 4_000_000) throw new Error('Saved effect presets exceed the storage limit')
  const parsed: unknown = JSON.parse(text)
  if (!Array.isArray(parsed) || parsed.length > 50) throw new Error('Invalid effect preset library')
  return parsed.map((item: unknown) => {
    if (!item || typeof item !== 'object' || !('id' in item) || typeof item.id !== 'string' || !('name' in item) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80 || !('effects' in item) || !Array.isArray(item.effects) || item.effects.length > 64) throw new Error('Invalid effect preset')
    return { id: item.id, name: item.name, effects: item.effects.map((effect: unknown) => {
      if (!effect || typeof effect !== 'object' || !('kind' in effect) || typeof effect.kind !== 'string' || !filterRegistry.list().some(def => def.kind === effect.kind) || !('parameters' in effect) || !effect.parameters || typeof effect.parameters !== 'object') throw new Error('Invalid preset effect')
      return filterRegistry.normalize(effect as LayerAdjustment)
    }) }
  })
}
export function saveEffectPreset(presets: readonly EffectPreset[], name: string, effects: readonly LayerAdjustment[]): EffectPreset[] {
  if (!name.trim() || name.length > 80) throw new Error('Enter a preset name with 1–80 characters')
  if (!effects.length || effects.length > 64) throw new Error('A preset needs 1–64 effects')
  if (presets.length >= 50) throw new Error('Remove a preset before saving another (limit 50)')
  // Selection masks belong to their source image, not a reusable look.
  const clean = effects.map(effect => { const copy = cloneAdjustment(effect); delete copy.selection; return copy })
  const next = [...presets, { id: crypto.randomUUID(), name: name.trim(), effects: clean }]
  persist(next)
  return next
}
export function persist(presets: readonly EffectPreset[]): void {
  const text = JSON.stringify(presets)
  if (text.length > 4_000_000) throw new Error('Preset library exceeds 4 MB; remove a LUT preset before saving')
  localStorage.setItem(KEY, text)
}
export function instantiatePreset(preset: EffectPreset): LayerAdjustment[] { return preset.effects.map(effect => ({ ...cloneAdjustment(effect), id: crypto.randomUUID() })) }
