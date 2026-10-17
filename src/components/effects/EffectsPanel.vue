<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useMutationObserver } from '@vueuse/core'
import EffectsLibrary from './EffectsLibrary.vue'
import EffectControls from './EffectControls.vue'
import EffectStack from './EffectStack.vue'
import EditorIcon from '../editor/Icon.vue'
import { useDialogFocus } from '~/composables/useDialogFocus'
import { useEffectDraft } from '~/composables/useEffectDraft'
import { filterRegistry } from '~/core/filters/FilterRegistry'
import { parseCube } from '~/core/filters/EffectPipeline'
import { ADJUSTMENT_PRESETS, createAdjustmentPreset, type AdjustmentPreset } from '~/core/filters/AdjustmentPresets'
import { instantiatePreset, loadEffectPresets, persist, saveEffectPreset, type EffectPreset } from '~/persistence/EffectPresets'
import type { GroupLayer, RasterLayer } from '~/core/model/types'
const props = defineProps<{ layer: RasterLayer | GroupLayer | null; category: string }>()
const emit = defineEmits<{ close: [] }>()
const surface = ref<HTMLElement | null>(null)
const observedCanvas = ref<HTMLCanvasElement | null>(null), rendering = ref(false)
onMounted(() => { observedCanvas.value = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Document canvas"]') })
useMutationObserver(observedCanvas, () => { rendering.value = observedCanvas.value?.getAttribute('aria-busy') === 'true' }, { attributes: true, attributeFilter: ['aria-busy'] })
useDialogFocus(surface, '[aria-label="Search effects"]')
const state = useEffectDraft(props.layer)
const { draft, active, error, selectedId, preview, comparing, selectionOnly } = state
const tab = ref<'library' | 'stack' | 'presets'>('library'), name = ref(''), presetId = ref('brighten')
const userPresets = ref<EffectPreset[]>([])
onMounted(() => state.safely(() => { userPresets.value = loadEffectPresets() }))
function close(): void { state.cancel(); emit('close') }
function apply(): void { if (state.apply()) emit('close') }
function save(): void { state.safely(() => { userPresets.value = saveEffectPreset(userPresets.value, name.value, draft.value); name.value = '' }) }
function removePreset(id: string): void { state.safely(() => { const next = userPresets.value.filter(preset => preset.id !== id); persist(next); userPresets.value = next }) }
async function loadLut(file: File): Promise<void> {
  const targetId = active.value?.id
  try { if (file.size > 4_000_000) throw new Error('LUT file exceeds 4 MB'); const lut = parseCube(await file.text()); if (active.value?.id === targetId) state.update({ lut }) }
  catch (reason) { error.value = reason instanceof Error ? reason.message : 'LUT could not be loaded' }
}
</script>
<template>
  <Teleport to="body">
    <div class="effects-overlay fixed inset-0 z-50 flex items-stretch justify-end bg-black/10 pb-8 pt-[84px]" @mousedown.self="close" @keydown.stop @keydown.esc.prevent="close">
      <section ref="surface" tabindex="-1" class="effects-panel mr-3 flex w-[360px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border border-ui-border bg-ui-panel text-ui-text shadow-2xl" role="dialog" aria-modal="true" aria-label="Photo Effects">
        <header class="flex items-center justify-between border-b border-ui-border px-4 py-3">
          <div><h1 class="text-sm font-semibold">Photo Effects</h1><p class="mt-0.5 max-w-64 truncate text-[10px] text-ui-secondary-text">{{ layer ? `Layer: ${layer.name}` : 'Select an unlocked raster layer or group' }}</p></div>
          <button class="grid h-7 w-7 place-items-center rounded hover:bg-ui-hover" aria-label="Close effects" @click="close"><EditorIcon name="x" :size="16" /></button>
        </header>
        <template v-if="layer">
          <div class="flex items-center justify-between border-b border-ui-border px-4 py-2 text-[11px]">
            <label class="flex items-center gap-2"><input v-model="preview" type="checkbox" class="accent-accent" @change="state.flush">Preview</label>
            <button class="rounded border border-ui-border px-2 py-1 hover:bg-ui-hover" :aria-pressed="comparing" @click="comparing = !comparing; state.flush()">{{ comparing ? 'Show After' : 'Show Before' }}</button>
          </div>
          <p v-if="rendering" role="status" class="px-4 py-1 text-[10px] text-ui-secondary-text">Rendering preview…</p>
          <p v-if="comparing" class="bg-accent/10 px-4 py-1 text-[10px] text-accent" role="status">Before · Original layer without effects</p>
          <nav class="flex gap-1 border-b border-ui-border px-3 py-2" aria-label="Effect sections"><button v-for="item in ['library', 'stack', 'presets'] as const" :key="item" class="flex-1 rounded-lg px-2 py-1.5 text-xs capitalize" :class="tab === item ? 'bg-ui-active text-ui-text' : 'text-ui-secondary-text hover:bg-ui-hover'" :aria-pressed="tab === item" @click="tab = item">{{ item }}{{ item === 'stack' ? ` (${draft.length})` : '' }}</button></nav>
          <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
            <template v-if="tab === 'library'">
              <label v-if="state.owner.selection && layer.kind === 'raster'" class="flex items-center gap-2 text-[11px] text-ui-secondary-text"><input v-model="selectionOnly" type="checkbox" class="accent-accent">New effects: selected area only</label>
              <EffectsLibrary :layer="layer" :initial-category="category" @select="state.add($event); tab = 'stack'" />
            </template>
            <template v-else-if="tab === 'stack'">
              <EffectStack :effects="draft" :selected-id="selectedId" @edit="selectedId = $event" @toggle="state.toggle" @remove="state.remove" @move="state.move" />
              <div v-if="active" class="rounded-lg border border-ui-border p-3"><h2 class="mb-4 text-xs font-semibold">{{ filterRegistry.get(active.kind).label }}</h2><EffectControls :effect="active" @parameter="state.parameter" @opacity="state.update({ opacity: $event })" @blend="state.update($event ? { blendMode: $event } : {})" @lut="loadLut" /></div>
              <button class="w-full rounded-lg border border-dashed border-ui-border py-2 text-xs text-ui-secondary-text hover:border-accent hover:text-ui-text" @click="tab = 'library'">+ Add another effect</button>
            </template>
            <template v-else>
              <h2 class="text-xs font-semibold">Built-in looks</h2>
              <label class="block text-[11px] text-ui-secondary-text">Look<select v-model="presetId" class="mt-1 h-8 w-full rounded border border-ui-border bg-ui-elevated px-2"><option v-for="preset in ADJUSTMENT_PRESETS" :key="preset.id" :value="preset.id">{{ preset.label }}</option></select></label>
              <button class="effect-button w-full" @click="state.append(createAdjustmentPreset(presetId as AdjustmentPreset)); tab = 'stack'">Preview look</button>
              <h2 class="text-xs font-semibold">My favorite combinations</h2>
              <p v-if="!userPresets.length" class="text-[11px] text-ui-secondary-text">Save the current stack as an editable preset.</p>
              <div v-for="preset in userPresets" :key="preset.id" class="flex items-center gap-2"><button class="effect-button min-w-0 flex-1 truncate text-left" @click="state.append(instantiatePreset(preset)); tab = 'stack'">{{ preset.name }}</button><button class="grid h-7 w-7 place-items-center rounded hover:bg-ui-hover" :aria-label="`Delete preset ${preset.name}`" @click="removePreset(preset.id)"><EditorIcon name="x" :size="14" /></button></div>
              <form class="flex gap-2" @submit.prevent="save"><input v-model="name" aria-label="Preset name" placeholder="Name this combination" maxlength="80" class="h-8 min-w-0 flex-1 rounded border border-ui-border bg-ui-elevated px-2 text-xs"><button class="effect-button" type="submit" :disabled="!draft.length || !name.trim()">Save preset</button></form>
            </template>
            <p v-if="error" role="alert" class="rounded-lg border border-danger p-2 text-xs text-danger">{{ error }}</p>
          </div>
        </template>
        <p v-else class="p-5 text-xs leading-relaxed text-ui-secondary-text">Effects work on raster layers and groups. Select one in the Layers panel, then open Effects. Unlock the layer before editing.</p>
        <footer class="flex shrink-0 items-center justify-between gap-2 border-t border-ui-border p-3">
          <button class="effect-button" :disabled="!active" @click="state.reset">Reset</button>
          <div class="flex gap-2"><button class="effect-button" @click="close">Cancel</button><button class="effect-button border-accent bg-accent text-white hover:bg-accent-hover" :disabled="!layer" @click="apply">Apply</button></div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
@reference "../../assets/css/main.css";
.effect-button { @apply rounded-lg border border-ui-border px-3 py-1.5 text-xs hover:bg-ui-hover disabled:opacity-30; }
@media (max-height: 600px) { .effects-overlay { padding-top: 12px; padding-bottom: 12px; } }
</style>
