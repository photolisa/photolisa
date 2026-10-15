<script setup lang="ts">
import { nextTick, ref } from 'vue'
import EditorIcon from './Icon.vue'
import type { DocumentTab } from '~/core/DocumentManager'
import {Icon} from "@iconify/vue";

const props = defineProps<{ tabs: readonly DocumentTab[]; canReopen: boolean }>()
const emit = defineEmits<{
  activate: [id: string]
  close: [id: string]
  rename: [id: string, name: string]
  reorder: [sourceId: string, targetId: string, after: boolean]
  newDocument: []
  reopen: []
  transferDrop: [payload: { targetId: string; layerId: string; mode: 'copy' | 'move' }]
}>()

const editingId = ref<string | null>(null)
const draftName = ref('')
const nameInput = ref<HTMLInputElement | null>(null)

async function beginRename(tab: DocumentTab): Promise<void> {
  editingId.value = tab.id
  draftName.value = tab.name
  await nextTick()
  nameInput.value?.select()
}

function commitRename(): void {
  if (!editingId.value) return
  const name = draftName.value.trim()
  if (name) emit('rename', editingId.value, name)
  editingId.value = null
}

function onDragStart(event: DragEvent, id: string): void {
  event.dataTransfer?.setData('application/x-photolisa-tab', id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDragOver(event: DragEvent): void {
  if (!event.dataTransfer) return
  event.dataTransfer.dropEffect = event.dataTransfer.types.includes('application/x-photolisa-layer')
    ? (event.shiftKey ? 'move' : 'copy')
    : 'move'
}

function onDrop(event: DragEvent, targetId: string): void {
  const layerId = event.dataTransfer?.getData('application/x-photolisa-layer')
  if (layerId) { emit('transferDrop', { targetId, layerId, mode: event.shiftKey ? 'move' : 'copy' }); return }
  const sourceId = event.dataTransfer?.getData('application/x-photolisa-tab')
  if (!sourceId || sourceId === targetId) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  emit('reorder', sourceId, targetId, event.clientX >= rect.left + rect.width / 2)
}

defineExpose({ renameActive: () => { const tab = props.tabs.find((item) => item.active); if (tab) void beginRename(tab) } })
</script>

<template>
  <div class="document-tabs flex h-10 shrink-0 items-stretch pl-1 bg-ui-toolbar" aria-label="Project tabs">
    <button type="button" class="h-10 w-10 flex-center mr-2 cursor-normal" title="beta">
      <span class="flex-center h-8 w-8 rounded-xl bg-white/5 text-white/70 text-lg">
        <Icon icon="tabler:beta"/>
      </span>
    </button>

    <div class="flex items-center px-1 gap-2 min-w-0 flex-1 overflow-x-auto" role="tablist" aria-label="Open projects">
      <div
        class="group flex items-center justify-center w-7 shrink-0 items-center h-7 gap-2  rounded-full px-3 text-xs"
        :class=" 'bg-white/5 ring ring-white/10 hover:ring-white/50 text-ui-secondary-text hover:bg-ui-hover'"
        role="tab"
        draggable="false"
        :title="`Home`"
        @click="emit('activate', 0)"
      >
        <EditorIcon name="home" :size="14" class="shrink-0 text-ui-secondary-text" />
      </div>

      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="group flex min-w-32 max-w-56 shrink-0 items-center h-7 gap-2  rounded-full pl-3 pr-1 text-xs"
        :class="tab.active ? 'ring ring-white/50  bg-ui-elevated text-ui-text' : 'bg-white/5 ring ring-white/10 text-ui-secondary-text hover:bg-ui-hover hover:ring-white/50'"
        role="tab"
        :aria-selected="tab.active"
        :aria-label="`${tab.name}${tab.dirty ? ' unsaved' : ''}`"
        :tabindex="tab.active ? 0 : -1"
        draggable="true"
        :title="tab.active ? tab.name : `${tab.name} — drop layers to copy; hold Shift to move`"
        @click="emit('activate', tab.id)"
        @keydown.enter.prevent="emit('activate', tab.id)"
        @keydown.space.prevent="emit('activate', tab.id)"
        @dblclick="beginRename(tab)"
        @dragstart="onDragStart($event, tab.id)"
        @dragover.prevent="onDragOver"
        @drop.prevent="onDrop($event, tab.id)"
      >
        <EditorIcon name="image" :size="15" class="shrink-0 text-ui-secondary-text" />
        <span v-if="tab.dirty" class="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
        <input
          v-if="editingId === tab.id"
          ref="nameInput"
          v-model="draftName"
          class="min-w-0 flex-1 border border-accent bg-ui-elevated px-1 text-ui-text"
          :aria-label="`Rename ${tab.name}`"
          @click.stop
          @keydown.enter.stop.prevent="commitRename"
          @keydown.escape.stop.prevent="editingId = null"
          @blur="commitRename"
        >
        <span v-else class="min-w-0 flex-1 truncate">{{ tab.name }}</span>
        <button class="grid h-6 w-6 shrink-0 place-items-center text-ui-secondary-text hover:text-ui-text" :aria-label="`Close ${tab.name}`" :title="`Close ${tab.name}`" @click.stop="emit('close', tab.id)">
          <EditorIcon name="x" :size="17" />
        </button>
      </div>
      <button class="bg-white/5 grid size-7 rounded-full place-items-center ring ring-white/10 hover:ring-white/50 text-ui-secondary-text hover:bg-ui-hover" aria-label="Add project tab" title="Add project tab" @click="emit('newDocument')"><EditorIcon name="plus" :size="18" /></button>
      <button class="bg-white/5 grid size-7 rounded-full place-items-center ring ring-white/10 hover:ring-white/50 text-ui-secondary-text hover:bg-ui-hover disabled:opacity-50" aria-label="Reopen closed tab" title="Reopen closed tab" :disabled="!canReopen" @click="emit('reopen')"><EditorIcon name="rotate-ccw" :size="16" /></button>
    </div>
  </div>
</template>
