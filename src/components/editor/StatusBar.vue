<script setup lang="ts">
import EditorIcon from './Icon.vue'
import type { EditorDocument } from '~/core/model/EditorDocument'

defineProps<{ document: EditorDocument | null; zoom: number }>()
const emit = defineEmits<{ zoom: [value: number] }>()
</script>

<template>
  <footer class="flex h-7 shrink-0 items-center pl-12 pr-62 bg-ui-toolbar px-3 text-[11px] text-ui-secondary-text">
    <template v-if="document">
      <span>{{ document.dimensions.width }} × {{ document.dimensions.height }} px</span>
      <span class="mx-3 text-ui-muted">|</span>
      <span>{{ document.dimensions.resolution }} ppi</span>
    </template>
    <span v-else>Ready</span>
    <div class="ml-auto flex items-center gap-2">
      <button class="grid h-5 w-5 place-items-center hover:text-ui-text" aria-label="Zoom out" title="Zoom out" @click="emit('zoom', zoom / 1.2)"><EditorIcon name="minus" :size="14" /></button>
      <input
        class="h-1 w-24 cursor-pointer accent-accent"
        type="range"
        min="5"
        max="800"
        :value="Math.round(zoom * 100)"
        aria-label="Zoom"
        @input="emit('zoom', Number(($event.target as HTMLInputElement).value) / 100)"
      >
      <button class="grid h-5 w-5 place-items-center hover:text-ui-text" aria-label="Zoom in" title="Zoom in" @click="emit('zoom', zoom * 1.2)"><EditorIcon name="plus" :size="14" /></button>
      <span class="w-10 text-right text-ui-text">{{ Math.round(zoom * 100) }}%</span>
    </div>
  </footer>
</template>
