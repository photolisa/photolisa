<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CanvasAnchor } from '~/core/commands/DocumentGeometryCommands'
import type { ResizeQuality } from '../../raster/commands/ImageResizeCommand'

const props = defineProps<{ mode: 'resize' | 'canvas'; width: number; height: number }>()
const emit = defineEmits<{ apply: [options: { width: number; height: number; quality: ResizeQuality; anchor: CanvasAnchor }]; close: [] }>()
const width = ref(props.width)
const height = ref(props.height)
const quality = ref<ResizeQuality>('high')
const anchor = ref<CanvasAnchor>('center')
const error = computed(() => !Number.isInteger(width.value) || !Number.isInteger(height.value) || width.value < 1 || height.value < 1
  || width.value > 16_384 || height.value > 16_384 || width.value * height.value > 67_108_864)
</script>

<template>
  <div class="fixed inset-0 z-50 grid place-items-center bg-black/70" @click.self="emit('close')">
    <div class="w-80 border border-ui-border bg-ui-panel p-4 text-xs text-ui-text shadow-2xl" role="dialog" :aria-label="mode === 'resize' ? 'Resize image' : 'Canvas size'">
      <h2 class="mb-3 text-sm font-semibold">{{ mode === 'resize' ? 'Resize image' : 'Canvas size' }}</h2>
      <div class="space-y-2">
        <label class="flex items-center justify-between gap-2">Width (px)<input v-model.number="width" type="number" min="1" max="16384" class="w-28 border border-ui-border bg-ui-elevated px-2 py-1" aria-label="New width"></label>
        <label class="flex items-center justify-between gap-2">Height (px)<input v-model.number="height" type="number" min="1" max="16384" class="w-28 border border-ui-border bg-ui-elevated px-2 py-1" aria-label="New height"></label>
        <label v-if="mode === 'resize'" class="flex items-center justify-between gap-2">Resampling<select v-model="quality" class="border border-ui-border bg-ui-elevated px-2 py-1" aria-label="Resampling quality"><option value="nearest">Nearest</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
        <label v-else class="flex items-center justify-between gap-2">Anchor<select v-model="anchor" class="border border-ui-border bg-ui-elevated px-2 py-1" aria-label="Canvas anchor"><option value="center">Center</option><option value="top-left">Top left</option></select></label>
        <p v-if="error" class="text-danger">Dimensions must fit within 16,384 × 16,384 and 67 million pixels.</p>
        <p v-else-if="mode === 'resize'" class="text-ui-secondary-text">Layer pixels are resampled. Undo restores the originals.</p>
        <p v-else class="text-ui-secondary-text">Canvas size changes the visible area without resampling pixels.</p>
      </div>
      <div class="mt-4 flex justify-end gap-2"><button class="border border-ui-border px-3 py-1" @click="emit('close')">Cancel</button><button class="border border-accent bg-accent px-3 py-1 text-ui-text disabled:opacity-40" :disabled="error" @click="emit('apply', { width, height, quality, anchor })">Apply</button></div>
    </div>
  </div>
</template>
