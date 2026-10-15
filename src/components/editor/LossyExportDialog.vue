<script setup lang="ts">
import { computed, ref } from 'vue'
const props = defineProps<{ format: 'jpeg' | 'webp'; name: string }>()
const emit = defineEmits<{ export: [quality: number, name: string]; close: [] }>()
const quality = ref(92)
const name = ref(props.name)
const valid = computed(() => name.value.trim().length > 0 && quality.value >= 1 && quality.value <= 100)
</script>

<template>
  <div class="fixed inset-0 z-50 grid place-items-center bg-black/70" @click.self="emit('close')">
    <section class="w-80 border border-ui-border bg-ui-panel p-4 text-xs text-ui-text shadow-2xl" role="dialog" :aria-label="`Export ${format.toUpperCase()}`">
      <h2 class="mb-3 text-sm font-semibold">Export {{ format.toUpperCase() }}</h2>
      <div class="space-y-3">
        <label class="flex items-center justify-between gap-2">File name<input v-model="name" class="w-48 border border-ui-border bg-ui-elevated px-2 py-1" aria-label="Export file name"></label>
        <label class="flex items-center gap-2">Quality<input v-model.number="quality" class="min-w-0 flex-1 accent-accent" type="range" min="1" max="100" aria-label="Export quality"><span class="w-9 text-right">{{ quality }}%</span></label>
        <p class="text-ui-secondary-text">Exports the full image. JPEG uses a white background for transparent pixels.</p>
      </div>
      <footer class="mt-4 flex justify-end gap-2">
        <button class="border border-ui-border px-3 py-1" @click="emit('close')">Cancel</button>
        <button class="border border-accent bg-accent px-3 py-1 text-ui-text disabled:opacity-40" :disabled="!valid" @click="emit('export', quality / 100, name.trim())">Export</button>
      </footer>
    </section>
  </div>
</template>
