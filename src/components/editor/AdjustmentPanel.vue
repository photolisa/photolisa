<script setup lang="ts">
import { shallowRef, ref, computed, onUnmounted, watch } from 'vue'
import { useDialogFocus } from '../../composables/useDialogFocus'
import EditorIcon from './Icon.vue'
import { AdjustmentPreviewSession, SetLayerAdjustmentsCommand } from '~/core/commands/AdjustmentCommands'
import { cloneAdjustment, filterRegistry } from '~/core/filters/FilterRegistry'
import { ADJUSTMENT_PRESETS, createAdjustmentPreset, type AdjustmentPreset } from '~/core/filters/AdjustmentPresets'
import type { AdjustmentKind, LayerAdjustment } from '~/core/filters/types'
import type { GroupLayer, RasterLayer } from '~/core/model/types'
import { editorCore } from '~/composables/useEditor'

const surface = ref<HTMLElement | null>(null)
useDialogFocus(surface)

const props = defineProps<{ layer: RasterLayer | GroupLayer; revision: number }>()
const selectedKind = ref<AdjustmentKind>('brightness-contrast')
const selectedPreset = ref<AdjustmentPreset>('brighten')
const editingId = ref<string | null>(null)
const session = shallowRef<AdjustmentPreviewSession | null>(null)

const definitions = filterRegistry.list()
const adjustments = computed(() => {
  void props.revision
  return props.layer.adjustments
})
const activeAdjustment = computed(() => adjustments.value.find((adjustment) => adjustment.id === editingId.value) ?? null)
const activeDefinition = computed(() => activeAdjustment.value ? filterRegistry.get(activeAdjustment.value.kind) : null)
const controls = computed(() => activeAdjustment.value ? CONTROL_SCHEMAS[activeAdjustment.value.kind] : [])

function add(): void {
  closePreview(true)
  session.value = new AdjustmentPreviewSession(editorCore, props.layer.id)
  const adjustment = editorCore.adjustments.add(props.layer.id, selectedKind.value)
  editingId.value = adjustment.id
}

function addPreset(): void {
  closePreview(true)
  commit([...adjustments.value.map(cloneAdjustment), ...createAdjustmentPreset(selectedPreset.value)])
}

function edit(adjustment: LayerAdjustment): void {
  closePreview(true)
  session.value = new AdjustmentPreviewSession(editorCore, props.layer.id)
  editingId.value = adjustment.id
}

function updateParameter(key: string, event: Event): void {
  const adjustment = activeAdjustment.value
  if (!adjustment) return
  const value = Number((event.target as HTMLInputElement).value)
  editorCore.adjustments.update(props.layer.id, adjustment.id, { [key]: value } as never)
}

function reset(): void {
  if (editingId.value) editorCore.adjustments.reset(props.layer.id, editingId.value)
}

function apply(): void {
  session.value?.apply()
  session.value = null
  editingId.value = null
}

function cancel(): void { closePreview(true) }

function closePreview(restore: boolean): void {
  if (restore) session.value?.cancel()
  session.value = null
  editingId.value = null
}

function commit(next: LayerAdjustment[]): void {
  const before = editorCore.adjustments.snapshot(props.layer.id)
  editorCore.execute(new SetLayerAdjustmentsCommand(props.layer.id, before, next))
}

function toggle(adjustment: LayerAdjustment): void {
  commit(adjustments.value.map((item) => item.id === adjustment.id ? { ...cloneAdjustment(item), enabled: !item.enabled } : cloneAdjustment(item)))
}

function remove(adjustment: LayerAdjustment): void {
  commit(adjustments.value.filter((item) => item.id !== adjustment.id).map(cloneAdjustment))
}

function move(adjustment: LayerAdjustment, delta: number): void {
  const next = adjustments.value.map(cloneAdjustment)
  const from = next.findIndex((item) => item.id === adjustment.id)
  const to = Math.max(0, Math.min(next.length - 1, from + delta))
  if (from < 0 || from === to) return
  const [item] = next.splice(from, 1)
  if (item) next.splice(to, 0, item)
  commit(next)
}

watch(() => props.layer.id, () => closePreview(true))
onUnmounted(() => closePreview(true))

interface ControlSchema { key: string; label: string; min: number; max: number; step: number; suffix?: string }
const CONTROL_SCHEMAS: Record<AdjustmentKind, ControlSchema[]> = {
  'brightness-contrast': [
    { key: 'brightness', label: 'Brightness', min: -1, max: 1, step: 0.01 },
    { key: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.01 },
  ],
  exposure: [{ key: 'stops', label: 'Exposure', min: -5, max: 5, step: 0.05, suffix: ' EV' }],
  saturation: [{ key: 'amount', label: 'Saturation', min: -1, max: 1, step: 0.01 }],
  hue: [{ key: 'degrees', label: 'Hue', min: -180, max: 180, step: 1, suffix: '°' }],
  temperature: [{ key: 'amount', label: 'Temperature', min: -1, max: 1, step: 0.01 }],
  grayscale: [{ key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01 }],
  sepia: [{ key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01 }],
  invert: [{ key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01 }],
  'gaussian-blur': [{ key: 'radius', label: 'Radius', min: 0, max: 50, step: 0.5, suffix: ' px' }],
  sharpen: [{ key: 'amount', label: 'Amount', min: 0, max: 2, step: 0.01 }],
  levels: [
    { key: 'inputBlack', label: 'Input black', min: 0, max: 254, step: 1 },
    { key: 'inputWhite', label: 'Input white', min: 1, max: 255, step: 1 },
    { key: 'gamma', label: 'Gamma', min: 0.1, max: 10, step: 0.05 },
    { key: 'outputBlack', label: 'Output black', min: 0, max: 255, step: 1 },
    { key: 'outputWhite', label: 'Output white', min: 0, max: 255, step: 1 },
  ],
}

function parameterValue(adjustment: LayerAdjustment, key: string): number {
  return Number((adjustment.parameters as unknown as Record<string, number>)[key] ?? 0)
}
</script>

<template>
  <section class="space-y-2" aria-label="Adjustments">
    <div class="flex items-center justify-between">
      <h3 class="text-[10px] font-semibold uppercase tracking-wider text-ui-secondary-text">Adjustments</h3>
      <span class="text-[10px] text-ui-muted">{{ adjustments.length }}</span>
    </div>
    <div v-if="adjustments.length" class="space-y-1">
      <div v-for="(adjustment, index) in adjustments" :key="adjustment.id" class="flex h-8 items-center gap-1 border border-ui-border bg-ui-elevated px-1">
        <button class="mini" :aria-label="adjustment.enabled ? `Disable ${filterRegistry.get(adjustment.kind).label}` : `Enable ${filterRegistry.get(adjustment.kind).label}`" :title="adjustment.enabled ? 'Disable adjustment' : 'Enable adjustment'" @click="toggle(adjustment)">
          <EditorIcon :name="adjustment.enabled ? 'eye' : 'eye-off'" :size="14" />
        </button>
        <button class="min-w-0 flex-1 truncate text-left" :class="adjustment.enabled ? 'text-ui-text' : 'text-ui-muted'" @click="edit(adjustment)">
          {{ filterRegistry.get(adjustment.kind).label }}
        </button>
        <button class="mini" aria-label="Move adjustment up" title="Move adjustment up" :disabled="index === 0" @click="move(adjustment, -1)"><EditorIcon name="arrow-up" :size="14" /></button>
        <button class="mini" aria-label="Move adjustment down" title="Move adjustment down" :disabled="index === adjustments.length - 1" @click="move(adjustment, 1)"><EditorIcon name="arrow-down" :size="14" /></button>
        <button class="mini" :aria-label="`Delete ${filterRegistry.get(adjustment.kind).label}`" title="Delete adjustment" @click="remove(adjustment)"><EditorIcon name="x" :size="14" /></button>
      </div>
    </div>
    <p v-else class="text-[11px] text-ui-muted">No adjustments on this layer.</p>
    <div class="flex gap-1">
      <select v-model="selectedKind" class="h-7 min-w-0 flex-1 border border-ui-border bg-ui-elevated px-1 text-ui-text" aria-label="Adjustment type">
        <option v-for="definition in definitions" :key="definition.kind" :value="definition.kind">{{ definition.label }}</option>
      </select>
      <button class="h-7 border border-ui-border px-2 text-ui-text hover:bg-ui-hover" @click="add">Add</button>
    </div>
    <div class="flex gap-1">
      <select v-model="selectedPreset" class="h-7 min-w-0 flex-1 border border-ui-border bg-ui-elevated px-1 text-ui-text" aria-label="Filter preset">
        <option v-for="preset in ADJUSTMENT_PRESETS" :key="preset.id" :value="preset.id">{{ preset.label }}</option>
      </select>
      <button class="h-7 border border-ui-border px-2 text-ui-text hover:bg-ui-hover" aria-label="Add selected look" @click="addPreset">Add look</button>
    </div>
  </section>

  <div v-if="activeAdjustment && activeDefinition" class="adjustment-overlay fixed inset-0 z-50 flex items-start justify-end bg-black/20 p-4 pt-32" @mousedown.self="cancel" @keydown.esc.stop.prevent="cancel">
    <section ref="surface" tabindex="-1" class="adjustment-popover w-[360px] border border-ui-border bg-ui-panel shadow-2xl" role="dialog" aria-modal="true" :aria-label="activeDefinition.label" @keydown.stop @keydown.esc.prevent="cancel">
      <header class="flex items-center justify-between border-b border-ui-border px-4 py-3 text-sm font-semibold text-ui-text"><span>{{ activeDefinition.label }}</span><button class="mini" aria-label="Close adjustment" title="Cancel adjustment preview" @click="cancel"><EditorIcon name="x" :size="16" /></button></header>
      <div class="space-y-4 p-5">
        <label v-for="control in controls" :key="control.key" class="grid grid-cols-[80px_minmax(0,1fr)_48px] items-center gap-3 text-xs text-ui-secondary-text">
          <span>{{ control.label }}</span>
          <input class="min-w-0 w-full accent-accent" type="range" :min="control.min" :max="control.max" :step="control.step" :value="parameterValue(activeAdjustment, control.key)" @input="updateParameter(control.key, $event)">
          <span class="text-right text-ui-text">{{ parameterValue(activeAdjustment, control.key) }}{{ control.suffix }}</span>
        </label>
      </div>
      <footer class="flex justify-between border-t border-ui-border px-4 py-3">
        <button class="dialog-button" @click="reset">Reset</button>
        <div class="flex gap-2">
          <button class="dialog-button" @click="cancel">Cancel</button>
          <button class="dialog-button border-accent bg-accent text-ui-text" @click="apply">Apply</button>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
@reference "../../assets/css/main.css";
.mini { @apply grid h-6 w-5 place-items-center text-ui-secondary-text hover:text-ui-text disabled:opacity-20; }
.dialog-button { @apply min-w-20 border border-ui-border px-3 py-1.5 text-xs text-ui-text hover:bg-ui-hover; }
.adjustment-popover { background: var(--color-ui-panel); }
@media (max-width: 600px), (max-height: 550px) { .adjustment-overlay { align-items: center; justify-content: center; padding-top: 16px; } }
</style>
