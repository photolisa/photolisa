<script setup lang="ts">
import { computed, nextTick, ref, watch, onUnmounted } from 'vue'
import { useStorage } from '@vueuse/core'
import EditorSidebarColorPanel from './SidebarColorPanel.vue'
import EditorAdjustmentPanel from './AdjustmentPanel.vue'
import EditorColorSwatches from './ColorSwatches.vue'
import EditorIcon from './Icon.vue'
import EditorLayerTreeItem from './LayerTreeItem.vue'
import VectorPaintPanel from './VectorPaintPanel.vue'
import VectorOperationsPanel from './VectorOperationsPanel.vue'
import EditorVectorGeometryPanel from './VectorGeometryPanel.vue'
import { useLayerCommands } from '../../composables/useLayerCommands'
import type { EditorDocument } from '~/core/model/EditorDocument'
import type { BlendMode, Layer } from '~/core/model/types'
import type { DocumentTab } from '~/core/DocumentManager'
import { editorCore } from '~/composables/useEditor'
import { RasterizeVectorCommand } from '../../raster/commands/RasterizeVectorCommand'
import { CreateLayerMaskCommand, SetLayerMaskCommand, type MaskCreation } from '../../raster/commands/MaskCommands'
import { rasterSources } from '~/raster/RasterSourceRegistry'
import { DEFAULT_TEXT, UpdateTextLayerCommand, propertiesOf, type TextProperties } from '~/core/commands/TextCommands'
import { loadTextFont } from '~/raster/TextPainter'

const props = defineProps<{ mode: 'simple' | 'pro'; document: EditorDocument | null; revision: number; projectTabs: readonly DocumentTab[] }>()
const emit = defineEmits<{ collapse: []; transfer: [payload: { layerIds: string[]; targetId: string; mode: 'copy' | 'move' | 'duplicate'; centerInDestination: boolean }] }>()
const actions = useLayerCommands()
const selectionAvailable = ref(Boolean(editorCore.selection))
const stopSelection = editorCore.events.on('selection:changed', (selection) => { selectionAvailable.value = Boolean(selection) })
onUnmounted(stopSelection)
const panelWidth = useStorage('photolisa.workspace.panelWidth', 288)
const propertiesHeight = useStorage('photolisa.workspace.propertiesHeight', 220)
const activePanel = ref<'layers' | 'properties' | 'adjustments'>('layers')
const showProperties = computed(() => activePanel.value !== 'layers' || props.mode === 'pro')
// Ignore stale or corrupted layout values without touching document state.
panelWidth.value = Number.isFinite(panelWidth.value) ? Math.min(480, Math.max(240, panelWidth.value)) : 288
propertiesHeight.value = Number.isFinite(propertiesHeight.value) ? Math.min(420, Math.max(150, propertiesHeight.value)) : 220
const bottomPanel = ref<'layers' | 'swatches'>('layers')
const transferMenu = ref<{ id: string; x: number; y: number } | null>(null)
const transferTargetId = ref('')
const centerTransfer = ref(false)
const textDraft = ref<TextProperties>({ ...DEFAULT_TEXT })
const textInput = ref<HTMLTextAreaElement | null>(null)
const otherProjects = computed(() => props.projectTabs.filter((tab) => tab.id !== props.document?.id))

function showTransferMenu(payload: { id: string; x: number; y: number }): void {
  transferMenu.value = { id: payload.id, x: Math.max(8, Math.min(payload.x, window.innerWidth - 240)), y: Math.max(8, Math.min(payload.y, window.innerHeight - 176)) }
  transferTargetId.value = otherProjects.value[0]?.id ?? ''
  centerTransfer.value = false
}

function transfer(mode: 'copy' | 'move' | 'duplicate'): void {
  const menu = transferMenu.value
  if (!menu || !transferTargetId.value || !props.document) return
  const selected = props.document.selectedLayerIds.includes(menu.id) ? props.document.selectedLayerIds : [menu.id]
  emit('transfer', { layerIds: [...selected], targetId: transferTargetId.value, mode, centerInDestination: centerTransfer.value })
  transferMenu.value = null
}

const activeLayer = computed(() => {
  void props.revision
  return props.document?.activeLayerId ? findLayer(props.document.layers, props.document.activeLayerId) : null
})

watch(activeLayer, async (layer) => {
  if (props.mode === 'simple' && (layer?.kind === 'vector' || layer?.kind === 'text')) activePanel.value = 'properties'
  if (layer?.kind !== 'text') return
  textDraft.value = propertiesOf(layer)
  if (editorCore.textEditingLayerId === layer.id) { await nextTick(); textInput.value?.focus(); textInput.value?.select() }
}, { immediate: true })

function editText(id: string): void {
  actions.select(id, 'replace')
  activePanel.value = 'properties'
  editorCore.setTextEditing(id)
  nextTick(() => { textInput.value?.focus(); textInput.value?.select() })
}

function commitText(): void {
  const layer = activeLayer.value
  if (layer?.kind !== 'text' || layer.locked) return
  const next = { ...textDraft.value }
  if (JSON.stringify(next) === JSON.stringify(propertiesOf(layer))) return
  if (!next.fontFamily.trim() || !Number.isFinite(next.fontSize) || next.fontSize < 1 || next.fontSize > 2048
    || !Number.isFinite(next.lineSpacing) || next.lineSpacing < 0.5 || next.lineSpacing > 4 || next.text.length > 10_000) return
  editorCore.execute(new UpdateTextLayerCommand(layer.id, next))
  void loadTextFont(layer)
}

const canGroup = computed(() => {
  void props.revision
  const document = props.document
  if (!document || document.selectedLayerIds.length === 0) return false
  const parents = document.selectedLayerIds.map((id) => editorCore.layers.locationOf(id)?.parentId)
  return parents.every((parent) => parent === parents[0])
})

function addLayer(): void {
  actions.add(activeLayer.value?.kind === 'group' ? activeLayer.value.id : null)
}

function selectLayer(id: string, mode: 'replace' | 'add' | 'toggle'): void {
  editorCore.setMaskEditing(null)
  actions.select(id, mode)
}

function editMask(id: string): void {
  actions.select(id, 'replace')
  editorCore.setMaskEditing(id)
}

function createMask(mode: MaskCreation): void {
  const layer = activeLayer.value
  if (!layer || layer.kind !== 'raster' || !props.document) return
  const source = layer.pixelSourceId ? rasterSources.get(layer.pixelSourceId) : null
  editorCore.execute(new CreateLayerMaskCommand(layer.id, mode, editorCore.selection, source?.width ?? props.document.dimensions.width, source?.height ?? props.document.dimensions.height))
  editorCore.setMaskEditing(layer.id)
}

function changeMask(action: 'enable' | 'disable' | 'invert' | 'remove'): void {
  const layer = activeLayer.value
  if (!layer?.mask) return
  editorCore.execute(new SetLayerMaskCommand(layer.id, action))
  if (action === 'remove') editorCore.setMaskEditing(null)
}

function moveLayer(payload: { sourceId: string; targetId: string; placement: 'before' | 'inside' | 'after' }): void {
  const target = editorCore.layers.find(payload.targetId)
  const location = editorCore.layers.locationOf(payload.targetId)
  if (!target || !location) return
  if (payload.placement === 'inside' && target.kind === 'group') {
    actions.move(payload.sourceId, target.id, target.children.length)
  } else {
    // The model is bottom-to-top while the layer panel is displayed top-to-bottom.
    actions.move(payload.sourceId, location.parentId, location.index + (payload.placement === 'before' ? 1 : 0))
  }
}

function changeOpacity(event: Event): void {
  if (activeLayer.value) actions.setOpacity(activeLayer.value.id, Number((event.target as HTMLInputElement).value) / 100)
}

function changeBlend(event: Event): void {
  if (activeLayer.value) actions.setBlendMode(activeLayer.value.id, (event.target as HTMLSelectElement).value as BlendMode)
}



function beginHorizontalResize(event: PointerEvent): void {
  const startX = event.clientX
  const startWidth = (event.currentTarget as HTMLElement).parentElement?.getBoundingClientRect().width ?? panelWidth.value
  trackPointer(
    (moveEvent) => { panelWidth.value = Math.min(480, Math.max(240, startWidth + startX - moveEvent.clientX)) },
  )
}

function beginVerticalResize(event: PointerEvent): void {
  const startY = event.clientY
  const startHeight = propertiesHeight.value
  trackPointer(
    (moveEvent) => { propertiesHeight.value = Math.min(420, Math.max(150, startHeight + moveEvent.clientY - startY)) },
  )
}

let stopResize: (() => void) | null = null
onUnmounted(() => stopResize?.())

function trackPointer(move: (event: PointerEvent) => void): void {
  stopResize?.()
  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
    stopResize = null
  }
  stopResize = stop
  window.addEventListener('pointercancel', stop, { once: true })
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop, { once: true })
}

function findLayer(layers: readonly Layer[], id: string): Layer | null {
  for (const layer of layers) {
    if (layer.id === id) return layer
    if (layer.kind === 'group') {
      const found = findLayer(layer.children, id)
      if (found) return found
    }
  }
  return null
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
</script>

<template>
  <aside aria-label="Editor panels" class="space-y-2 right-panels relative flex shrink-0 flex-col px-2 text-xs text-ui-text" :style="{ width: `${panelWidth}px` }">
    <button class="absolute -left-1 top-0 z-20 h-full w-2 cursor-col-resize" aria-label="Resize right panel" @pointerdown.prevent="beginHorizontalResize" @keydown.left.prevent="panelWidth = Math.min(480, panelWidth + 8)" @keydown.right.prevent="panelWidth = Math.max(240, panelWidth - 8)" />

    <button v-if="false" class="grid w-7 shrink-0 place-items-center text-ui-secondary-text hover:text-ui-text" aria-label="Collapse right panels" title="Collapse right panels" @click="emit('collapse')"><EditorIcon name="panelRight" :size="14" /></button>

    <div class="panel-tabs gap-1 flex h-10 shrink-0 items-stretch border border-ui-border rounded-xl bg-white/5 p-1" aria-label="Editor panel navigation">
      <button v-for="panel in ['layers', 'properties', 'adjustments'] as const" :key="panel"
              class="px-2 capitalize rounded-lg"
              :class="activePanel === panel ? 'bg-accent text-white' : 'border-transparent text-ui-secondary-text hover:bg-ui-hover'" :aria-pressed="activePanel === panel" @click="activePanel = panel">{{ panel }}</button>
    </div>

    <section v-show="showProperties" class="min-h-0 overflow-auto border border-ui-border rounded-xl bg-white/5" :class="activePanel === 'layers' ? 'shrink-0' : 'flex-1'" :style="activePanel === 'layers' ? { height: `${propertiesHeight}px`, maxHeight: '45%' } : {}">
      <h2 class="panel-heading">{{ activePanel === 'adjustments' ? 'Layer adjustments' : 'Properties' }}</h2>
      <div v-if="document" class="space-y-3 p-3">
        <div v-show="activePanel !== 'adjustments'" class="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1.5">
          <span class="text-ui-secondary-text">Document</span><span class="truncate">{{ document.name }}</span>
          <span class="text-ui-secondary-text">Size</span><span>{{ document.dimensions.width }} × {{ document.dimensions.height }} px</span>
        </div>
        <template v-if="activeLayer">
          <div v-show="activePanel !== 'adjustments'" class="h-px bg-ui-border" />
          <label v-show="activePanel !== 'adjustments'" class="property-row">
            <span>Blend</span>
            <select class="property-input" :value="activeLayer.blendMode" @change="changeBlend">
              <option value="normal">Normal</option>
              <option value="multiply">Multiply</option>
              <option value="screen">Screen</option>
              <option value="overlay">Overlay</option>
            </select>
          </label>
          <label v-show="activePanel !== 'adjustments'" class="property-row">
            <span>Opacity</span>
            <div class="flex items-center gap-2">
              <input class="min-w-0 flex-1 accent-accent" type="range" min="0" max="100" :value="Math.round(activeLayer.opacity * 100)" @change="changeOpacity">
              <span class="w-8 text-right">{{ Math.round(activeLayer.opacity * 100) }}%</span>
            </div>
          </label>
          <div v-show="activePanel !== 'adjustments'" class="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1.5" aria-label="Layer transform">
            <span class="text-ui-secondary-text">Position</span>
            <span data-testid="layer-position">{{ formatNumber(activeLayer.transform.x) }}, {{ formatNumber(activeLayer.transform.y) }} px</span>
            <span class="text-ui-secondary-text">Scale</span>
            <span>{{ formatNumber(activeLayer.transform.scaleX * 100) }}%, {{ formatNumber(activeLayer.transform.scaleY * 100) }}%</span>
            <span class="text-ui-secondary-text">Rotation</span>
            <span>{{ formatNumber(activeLayer.transform.rotation * 180 / Math.PI) }}°</span>
          </div>
          <div v-show="activePanel !== 'adjustments'" class="h-px bg-ui-border" />
          <p v-if="activePanel === 'adjustments' && activeLayer.kind !== 'raster' && activeLayer.kind !== 'group'" class="text-ui-secondary-text">Select a raster layer or group to add adjustments.</p>
          <EditorAdjustmentPanel v-if="activeLayer.kind === 'raster' || activeLayer.kind === 'group'" :layer="activeLayer" :revision="revision" />
          <div v-show="activePanel !== 'adjustments'" v-if="activeLayer.kind === 'text'" class="space-y-1.5" aria-label="Text properties">
            <textarea ref="textInput" v-model="textDraft.text" class="property-input h-16 w-full resize-y py-1" aria-label="Text content" :disabled="activeLayer.locked" @blur="commitText" @keydown.ctrl.enter.prevent="commitText" />
            <label v-show="activePanel !== 'adjustments'" class="property-row"><span>Font</span><input v-model="textDraft.fontFamily" class="property-input" aria-label="Font family" :disabled="activeLayer.locked" @change="commitText"></label>
            <div class="grid grid-cols-2 gap-1">
              <label class="text-ui-secondary-text">Size <input v-model.number="textDraft.fontSize" type="number" min="1" max="2048" class="property-input w-full" aria-label="Font size" :disabled="activeLayer.locked" @change="commitText"></label>
              <label class="text-ui-secondary-text">Weight <select v-model.number="textDraft.fontWeight" class="property-input w-full" aria-label="Font weight" :disabled="activeLayer.locked" @change="commitText"><option :value="400">Regular</option><option :value="700">Bold</option></select></label>
              <label class="text-ui-secondary-text">Style <select v-model="textDraft.fontStyle" class="property-input w-full" aria-label="Font style" :disabled="activeLayer.locked" @change="commitText"><option value="normal">Normal</option><option value="italic">Italic</option></select></label>
              <label class="text-ui-secondary-text">Align <select v-model="textDraft.alignment" class="property-input w-full" aria-label="Text alignment" :disabled="activeLayer.locked" @change="commitText"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
              <label class="text-ui-secondary-text">Spacing <input v-model.number="textDraft.lineSpacing" type="number" min="0.5" max="4" step="0.1" class="property-input w-full" aria-label="Line spacing" :disabled="activeLayer.locked" @change="commitText"></label>
              <label class="text-ui-secondary-text">Color <input v-model="textDraft.color" type="color" class="property-input w-full" aria-label="Text color" :disabled="activeLayer.locked" @change="commitText"></label>
            </div>
            <p class="text-[10px] text-ui-secondary-text">Missing fonts use the browser’s sans-serif fallback; the requested family stays in the project.</p>
          </div>
          <div v-show="activePanel !== 'adjustments'" v-if="activeLayer.kind === 'raster'" class="space-y-1 border-t border-ui-border pt-2" aria-label="Layer mask controls">
            <span class="text-ui-secondary-text">Layer mask</span>
            <div v-if="!activeLayer.mask" class="flex flex-wrap gap-1">
              <button class="mask-action" :disabled="activeLayer.locked" @click="createMask('reveal-all')">Reveal all</button>
              <button class="mask-action" :disabled="activeLayer.locked || !selectionAvailable" @click="createMask('reveal-selection')">Reveal selection</button>
              <button class="mask-action" :disabled="activeLayer.locked || !selectionAvailable" @click="createMask('hide-selection')">Hide selection</button>
            </div>
            <div v-else class="flex flex-wrap gap-1">
              <button class="mask-action" :disabled="activeLayer.locked" @click="changeMask(activeLayer.mask.enabled ? 'disable' : 'enable')">{{ activeLayer.mask.enabled ? 'Disable' : 'Enable' }}</button>
              <button class="mask-action" :disabled="activeLayer.locked" @click="changeMask('invert')">Invert</button>
              <button class="mask-action" :disabled="activeLayer.locked" @click="changeMask('remove')">Remove</button>
              <span v-if="editorCore.maskEditingLayerId === activeLayer.id" class="self-center text-accent">Painting mask</span>
            </div>
          </div>
          <div v-show="activePanel !== 'adjustments'" v-else-if="activeLayer.kind === 'vector'" class="space-y-2" aria-label="Vector style">
            <VectorPaintPanel :layer="activeLayer" :revision="revision" />
            <div v-show="activePanel !== 'adjustments'" class="h-px bg-ui-border" />
            <EditorVectorGeometryPanel :layer="activeLayer" :revision="revision" />
            <button class="w-full border border-ui-border px-2 py-1 text-left text-ui-text hover:bg-ui-hover disabled:opacity-40" :disabled="activeLayer.locked || !!activeLayer.svgMatrix || !!activeLayer.mask || !!activeLayer.adjustments.length" title="Convert this vector shape into an editable raster layer" @click="editorCore.execute(new RasterizeVectorCommand(activeLayer.id))">Rasterize shape</button>
          </div>
          <VectorOperationsPanel v-if="activeLayer.kind === 'vector' || activeLayer.kind === 'group'" :revision="revision" />
        </template>
      </div>
      <p v-else class="p-3 text-ui-secondary-text">No document selected</p>
    </section>

    <button v-show="activePanel === 'layers' && mode === 'pro'" class="h-1.5 shrink-0 cursor-row-resize border border-ui-border rounded-xl bg-ui-elevated hover:bg-ui-hover" aria-label="Resize properties panel" @pointerdown.prevent="beginVerticalResize" @keydown.up.prevent="propertiesHeight = Math.max(150, propertiesHeight - 8)" @keydown.down.prevent="propertiesHeight = Math.min(420, propertiesHeight + 8)" />

    <section v-show="activePanel === 'layers'" class="flex min-h-0 flex-1 flex-col border border-ui-border rounded-xl overflow-hidden">
      <div class="flex border-b border-ui-border bg-ui-panel text-[11px] font-semibold uppercase tracking-wider"><button aria-label="Show layer list" class="px-3 py-2" :class="bottomPanel === 'layers' ? 'border-b border-accent text-ui-text' : 'text-ui-secondary-text'" @click="bottomPanel = 'layers'">Layers</button><button class="px-3 py-2" :class="bottomPanel === 'swatches' ? 'border-b border-accent text-ui-text' : 'text-ui-secondary-text'" @click="bottomPanel = 'swatches'">Swatches</button></div>
      <div v-if="mode === 'simple' && activeLayer && bottomPanel === 'layers'" class="grid grid-cols-[1fr_auto] gap-2 border-b border-ui-border p-2">
        <select class="property-input" aria-label="Layer blend mode" :value="activeLayer.blendMode" @change="changeBlend"><option value="normal">Normal</option><option value="multiply">Multiply</option><option value="screen">Screen</option><option value="overlay">Overlay</option></select>
        <label class="flex items-center gap-2 text-ui-secondary-text">Opacity <input class="w-12 rounded border border-ui-border bg-ui-elevated px-1 py-1" type="number" min="0" max="100" aria-label="Layer opacity" :value="Math.round(activeLayer.opacity * 100)" @change="changeOpacity"></label>
      </div>
      <div v-if="bottomPanel === 'swatches'" class="min-h-0 flex-1 overflow-auto"><EditorColorSwatches /></div>
      <div v-else-if="document" class="min-h-0 flex-1 overflow-auto py-1" role="tree" aria-label="Document layers">
        <EditorLayerTreeItem
          v-for="layer in [...document.layers].reverse()"
          :key="layer.id"
          :layer="layer"
          :document="document"
          :revision="revision"
          :depth="0"
          :selected-ids="document.selectedLayerIds"
          :active-id="document.activeLayerId"
          @select="selectLayer"
          @edit-mask="editMask"
          @edit-text="editText"
          @rename="actions.rename"
          @visibility="actions.setVisibility"
          @lock="actions.setLocked"
          @drop-layer="moveLayer"
          @layer-context="showTransferMenu"
        />
      </div>
      <p v-else-if="bottomPanel === 'layers'" class="flex-1 p-3 text-ui-secondary-text">Layers appear here</p>
      <div v-if="bottomPanel === 'layers'" class="flex h-10 shrink-0 items-center justify-end gap-1 border-t border-ui-border px-2">
        <button class="layer-action" title="New empty layer" aria-label="New empty layer" :disabled="!document" @click="addLayer"><EditorIcon name="plus" :size="17" /></button>
        <button class="layer-action" title="Group selected layers" aria-label="Group selected layers" :disabled="!canGroup" @click="document && actions.group(document.selectedLayerIds)"><EditorIcon name="folder-plus" :size="17" /></button>
        <button class="layer-action" title="Ungroup active group" aria-label="Ungroup active group" :disabled="activeLayer?.kind !== 'group'" @click="activeLayer && actions.ungroup(activeLayer.id)"><EditorIcon name="folder-minus" :size="17" /></button>
        <button class="layer-action" title="Duplicate active layer" aria-label="Duplicate active layer" :disabled="!activeLayer" @click="activeLayer && actions.duplicate(activeLayer.id)"><EditorIcon name="copy-plus" :size="17" /></button>
        <button class="layer-action" title="Delete active layer" aria-label="Delete active layer" :disabled="!activeLayer" @click="activeLayer && actions.remove(activeLayer.id)"><EditorIcon name="trash" :size="17" /></button>
      </div>
    </section>
    <EditorSidebarColorPanel class="shrink-0" />
    <div v-if="transferMenu" class="fixed inset-0 z-40" @click="transferMenu = null" @contextmenu.prevent="transferMenu = null">
      <div class="absolute rounded-xl w-56 border border-ui-border bg-ui-panel p-2 shadow-2xl" :style="{ left: `${transferMenu.x}px`, top: `${transferMenu.y}px` }" @click.stop>
        <p class="mb-2 text-[11px] text-ui-secondary-text">Transfer layers to</p>
        <select v-model="transferTargetId" class="property-input mb-2 w-full" aria-label="Destination project">
          <option v-for="tab in otherProjects" :key="tab.id" :value="tab.id">{{ tab.name }}</option>
        </select>
        <label class="mb-2 flex items-center gap-2 text-[11px]"><input v-model="centerTransfer" type="checkbox">Center in destination</label>
        <button class="transfer-action" :disabled="!transferTargetId" @click="transfer('copy')">Copy to Project</button>
        <button class="transfer-action" :disabled="!transferTargetId" @click="transfer('move')">Move to Project</button>
        <button class="transfer-action" :disabled="!transferTargetId" @click="transfer('duplicate')">Duplicate to Project</button>
        <p v-if="!otherProjects.length" class="pt-1 text-[11px] text-ui-secondary-text">Open another project to transfer layers.</p>
      </div>
    </div>
  </aside>
</template>

<style scoped>
@reference "../../assets/css/main.css";
.panel-heading { @apply border-b border-ui-border bg-ui-panel px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-ui-secondary-text; }
.property-row { @apply grid grid-cols-[72px_1fr] items-center gap-2 text-ui-secondary-text; }
.property-input { border-radius: 6px; @apply h-7 min-w-0 border border-ui-border bg-ui-elevated px-2 text-ui-text; }
.layer-action { border-radius: 6px; @apply grid h-7 w-8 place-items-center text-sm text-ui-secondary-text hover:bg-ui-hover hover:text-ui-text disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent; }
.transfer-action { @apply block w-full px-2 py-1.5 text-left hover:bg-ui-hover disabled:opacity-30 disabled:hover:bg-transparent; }
.mask-action { border-radius: 5px; @apply border border-ui-border px-1.5 py-0.5 text-ui-text hover:bg-ui-hover disabled:opacity-30; }
.right-panels { max-width: min(480px, calc(100vw - 120px)); }
@media (min-width: 1024px) and (max-width: 1439px) { .right-panels { max-width: 280px; } }
@media (max-width: 1023px) { .right-panels { position: absolute; right: 0; top: 0; bottom: 0; z-index: 25; box-shadow: -12px 0 32px #0005; } }
@media (max-height: 700px) { .right-panels :deep(.color-square) { height: 64px; } }
</style>
