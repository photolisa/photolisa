import { computed, onUnmounted, ref, shallowRef } from 'vue'
import { editorCore } from './useEditor'
import { AdjustmentPreviewSession } from '../core/commands/AdjustmentCommands'
import { cloneAdjustment, filterRegistry } from '../core/filters/FilterRegistry'
import type { AdjustmentKind, LayerAdjustment } from '../core/filters/types'
import type { GroupLayer, RasterLayer } from '../core/model/types'
import { captureEffectSelection } from '../raster/EffectSelection'

export function useEffectDraft(layer: RasterLayer | GroupLayer | null) {
  const owner = editorCore
  const error = ref(''), selectedId = ref<string | null>(null), preview = ref(true), comparing = ref(false)
  const selectionOnly = ref(layer?.kind === 'raster' && Boolean(owner.selection))
  const before = layer ? owner.adjustments.snapshot(layer.id) : []
  const draft = shallowRef(before.map(cloneAdjustment))
  let session: AdjustmentPreviewSession | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const active = computed(() => draft.value.find(effect => effect.id === selectedId.value) ?? null)
  function safely(action: () => void): void { try { error.value = ''; action() } catch (reason) { error.value = reason instanceof Error ? reason.message : 'Effect could not be updated' } }
  function flush(): void {
    if (timer) clearTimeout(timer)
    timer = undefined
    if (!layer || owner.document?.id !== editorCore.document?.id) return
    safely(() => {
      session ??= new AdjustmentPreviewSession(owner, layer.id)
      owner.adjustments.replace(layer.id, comparing.value ? [] : preview.value ? draft.value : before)
    })
  }
  function schedule(): void { if (timer) clearTimeout(timer); timer = setTimeout(flush, 40) }
  function set(next: LayerAdjustment[]): void { draft.value = next; schedule() }
  function add(kind: AdjustmentKind): void {
    if (!layer) return
    safely(() => {
      if (draft.value.length >= 64) throw new Error('A layer can contain at most 64 effects')
      const effect = filterRegistry.create(kind)
      if (selectionOnly.value && layer.kind === 'raster') { const mask = captureEffectSelection(owner, layer); if (mask) effect.selection = mask }
      draft.value = [...draft.value, effect]; selectedId.value = effect.id; preview.value = true; comparing.value = false
      flush()
    })
  }
  function update(patch: Partial<Pick<LayerAdjustment, 'parameters' | 'opacity' | 'blendMode' | 'lut'>>): void {
    if (!active.value) return
    safely(() => set(draft.value.map(effect => effect.id === selectedId.value ? filterRegistry.normalize({ ...cloneAdjustment(effect), ...patch } as LayerAdjustment) : effect)))
  }
  function parameter(key: string, value: number): void { if (active.value) update({ parameters: { ...active.value.parameters, [key]: value } }) }
  function reset(): void { if (active.value) update({ parameters: { ...filterRegistry.get(active.value.kind).defaults }, opacity: 1, blendMode: 'normal' }) }
  function toggle(id: string): void { set(draft.value.map(effect => effect.id === id ? { ...effect, enabled: !effect.enabled } : effect)) }
  function remove(id: string): void { set(draft.value.filter(effect => effect.id !== id)); if (selectedId.value === id) selectedId.value = null }
  function move(id: string, delta: number): void {
    const next = [...draft.value], from = next.findIndex(effect => effect.id === id), to = Math.max(0, Math.min(next.length - 1, from + delta))
    if (from < 0 || from === to) return
    const [effect] = next.splice(from, 1); if (effect) next.splice(to, 0, effect); set(next)
  }
  function append(effects: LayerAdjustment[]): void { safely(() => { if (effects.length + draft.value.length > 64) throw new Error('The combined stack exceeds 64 effects'); draft.value = [...draft.value, ...effects]; selectedId.value = effects.at(-1)?.id ?? null; preview.value = true; comparing.value = false; flush() }) }
  function apply(): boolean {
    preview.value = true; comparing.value = false; flush()
    if (error.value) return false
    safely(() => { session?.apply(); session = null })
    return !error.value
  }
  function cancel(): void { if (timer) clearTimeout(timer); timer = undefined; session?.cancel(); session = null }
  onUnmounted(cancel)
  return { owner, draft, active, error, selectedId, preview, comparing, selectionOnly, set, add, update, parameter, reset, toggle, remove, move, append, apply, cancel, flush, safely }
}
