<script setup lang="ts">
import { nextTick, ref } from 'vue'
import EditorIcon from './Icon.vue'
import EditorLayerMaskThumbnail from './LayerMaskThumbnail.vue'
import EditorLayerThumbnail from './LayerThumbnail.vue'
import type { EditorDocument } from '~/core/model/EditorDocument'
import type { Layer } from '~/core/model/types'
import { editorCore } from '~/composables/useEditor'

defineOptions({ name: 'EditorLayerTreeItem' })
const props = defineProps<{
  layer: Layer
  document: EditorDocument
  revision: number
  depth: number
  selectedIds: string[]
  activeId: string | null
}>()
const emit = defineEmits<{
  select: [id: string, mode: 'replace' | 'add' | 'toggle']
  rename: [id: string, name: string]
  visibility: [id: string, visible: boolean]
  lock: [id: string, locked: boolean]
  dropLayer: [payload: { sourceId: string; targetId: string; placement: 'before' | 'inside' | 'after' }]
  layerContext: [payload: { id: string; x: number; y: number }]
  editMask: [id: string]
  editText: [id: string]
}>()

const collapsed = ref(false)
const editing = ref(false)
const draftName = ref(props.layer.name)
const input = ref<HTMLInputElement | null>(null)

async function beginRename(): Promise<void> {
  draftName.value = props.layer.name
  editing.value = true
  await nextTick()
  input.value?.select()
}

function commitRename(): void {
  if (!editing.value) return
  editing.value = false
  const name = draftName.value.trim()
  if (name && name !== props.layer.name) emit('rename', props.layer.id, name)
}

function select(event: MouseEvent): void {
  emit('select', props.layer.id, event.ctrlKey || event.metaKey ? 'toggle' : event.shiftKey ? 'add' : 'replace')
}

function onDragStart(event: DragEvent): void {
  event.dataTransfer?.setData('application/x-photolisa-layer', props.layer.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copyMove'
}

function onDrop(event: DragEvent): void {
  const sourceId = event.dataTransfer?.getData('application/x-photolisa-layer')
  if (!sourceId || sourceId === props.layer.id) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const ratio = (event.clientY - rect.top) / rect.height
  const placement = props.layer.kind === 'group' && ratio > 0.28 && ratio < 0.72
    ? 'inside'
    : ratio < 0.5 ? 'before' : 'after'
  emit('dropLayer', { sourceId, targetId: props.layer.id, placement })
}
</script>

<template>
  <div>
    <div
      class="group flex h-12 items-center gap-1 border-y border-transparent pr-1"
      data-layer-row
      role="treeitem"
      tabindex="0"
      :aria-selected="selectedIds.includes(layer.id)"
      :aria-level="depth + 1"
      :aria-expanded="layer.kind === 'group' ? !collapsed : undefined"
      :class="[
        selectedIds.includes(layer.id) ? 'bg-ui-active' : 'hover:bg-ui-hover',
        activeId === layer.id ? 'border-accent' : '',
      ]"
      :style="{ paddingLeft: `${depth * 14 + 4}px` }"
      draggable="true"
      @keydown.enter.self.prevent="emit('select', layer.id, 'replace')"
      @keydown.space.self.prevent="emit('select', layer.id, 'replace')"
      @click="select"
      @dblclick="layer.kind === 'text' ? emit('editText', layer.id) : beginRename()"
      @dragstart="onDragStart"
      @dragover.prevent
      @drop.prevent.stop="onDrop"
      @contextmenu.prevent.stop="emit('layerContext', { id: layer.id, x: $event.clientX, y: $event.clientY })"
    >
      <button class="grid h-7 w-6 place-items-center text-ui-secondary-text hover:text-ui-text" :aria-label="layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`" :title="layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`" @click.stop="emit('visibility', layer.id, !layer.visible)">
        <EditorIcon :name="layer.visible ? 'eye' : 'eye-off'" :size="16" />
      </button>
      <button v-if="layer.kind === 'group'" class="grid w-3 shrink-0 place-items-center text-ui-secondary-text" :aria-label="`${collapsed ? 'Expand' : 'Collapse'} ${layer.name}`" :aria-expanded="!collapsed" :title="collapsed ? 'Expand group' : 'Collapse group'" @click.stop="collapsed = !collapsed"><EditorIcon name="chevron-down" :size="12" :class="collapsed ? '-rotate-90' : ''" /></button>
      <span v-else class="w-3 shrink-0" />
      <EditorLayerThumbnail :layer="layer" :document="document" :revision="revision" />
      <button v-if="layer.mask" class="shrink-0" :class="editorCore.maskEditingLayerId === layer.id ? 'ring-2 ring-accent' : ''" :aria-label="`Edit mask of ${layer.name}`" :title="`Edit mask of ${layer.name}`" @click.stop="emit('editMask', layer.id)"><EditorLayerMaskThumbnail :source-id="layer.mask.pixelSourceId" :revision="revision" /></button>
      <input
        v-if="editing"
        ref="input"
        v-model="draftName"
        class="min-w-0 flex-1 border border-accent bg-ui-elevated px-1 py-1 text-ui-text"
        @click.stop
        @blur="commitRename"
        @keydown.enter.prevent="commitRename"
        @keydown.escape.prevent="editing = false"
      >
      <span v-else class="min-w-0 flex-1 truncate" :class="{ 'font-medium text-ui-text': activeId === layer.id, 'text-ui-secondary-text': !layer.visible }">{{ layer.name }}</span>
      <button class="grid h-7 w-6 place-items-center text-ui-secondary-text hover:text-ui-text" :aria-label="layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`" :title="layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`" @click.stop="emit('lock', layer.id, !layer.locked)">
        <EditorIcon :name="layer.locked ? 'lock' : 'lock-open'" :size="16" />
      </button>
    </div>
    <EditorLayerTreeItem
      v-for="child in layer.kind === 'group' && !collapsed ? [...layer.children].reverse() : []"
      :key="child.id"
      :layer="child"
      :document="document"
      :revision="revision"
      :depth="depth + 1"
      :selected-ids="selectedIds"
      :active-id="activeId"
      @select="(...args) => emit('select', ...args)"
      @rename="(...args) => emit('rename', ...args)"
      @visibility="(...args) => emit('visibility', ...args)"
      @lock="(...args) => emit('lock', ...args)"
      @drop-layer="(payload) => emit('dropLayer', payload)"
      @layer-context="(payload) => emit('layerContext', payload)"
      @edit-mask="(id) => emit('editMask', id)"
      @edit-text="(id) => emit('editText', id)"
    />
  </div>
</template>
