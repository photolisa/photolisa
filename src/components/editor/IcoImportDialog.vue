<script setup lang="ts">
import { ref } from 'vue'
import type { IcoEntry } from '~/adapters/IcoAdapter'

defineProps<{ name: string; entries: IcoEntry[]; busy: boolean }>()
const emit = defineEmits<{ open: [index: number]; close: [] }>()
const selected = ref(0)
</script>

<template>
  <div class="fixed inset-0 z-50 grid place-items-center bg-black/65" @mousedown.self="emit('close')">
    <section class="w-[min(28rem,90vw)] border border-ui-border bg-ui-panel shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="ico-import-title">
      <header id="ico-import-title" class="border-b border-ui-border px-4 py-3 text-sm font-semibold">Open icon resolution</header>
      <div class="space-y-3 p-4 text-xs">
        <p class="truncate text-ui-secondary-text" :title="name">{{ name }} contains {{ entries.length }} image{{ entries.length === 1 ? '' : 's' }}. Choose one to open as an editable raster document.</p>
        <div class="max-h-64 overflow-y-auto border border-ui-border">
          <label v-for="entry in entries" :key="entry.index" class="flex cursor-pointer items-center gap-3 border-b border-ui-border px-3 py-2 last:border-0 hover:bg-ui-hover">
            <input v-model.number="selected" type="radio" name="ico-resolution" :value="entry.index" :disabled="busy">
            <span class="tabular-nums">{{ entry.width }} × {{ entry.height }} px</span>
            <span class="ml-auto uppercase text-ui-secondary-text">{{ entry.encoding }} · {{ entry.bitDepth || 'unknown' }} bpp</span>
          </label>
        </div>
      </div>
      <footer class="flex justify-end gap-2 border-t border-ui-border px-4 py-3 text-xs">
        <button class="border border-ui-border px-3 py-1.5 hover:bg-ui-hover" :disabled="busy" @click="emit('close')">Cancel</button>
        <button class="bg-accent px-3 py-1.5 text-ui-text hover:bg-accent-hover disabled:opacity-50" :disabled="busy" @click="emit('open', selected)">{{ busy ? 'Opening…' : 'Open resolution' }}</button>
      </footer>
    </section>
  </div>
</template>
