<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { EyedropperSample } from '~/tools/EditorToolController'
import { colorHex, colorRgba } from '~/raster/SampledColor'

const props = defineProps<{ sample: EyedropperSample }>()
const pixelsCanvas = ref<HTMLCanvasElement | null>(null)
const position = computed(() => ({
  left: `${Math.max(8, Math.min(props.sample.clientX + 22, window.innerWidth - 162))}px`,
  top: `${Math.max(8, Math.min(props.sample.clientY + 22, window.innerHeight - 178))}px`,
}))

watch(() => props.sample, (sample) => {
  const context = pixelsCanvas.value?.getContext('2d')
  if (!context) return
  const image = context.createImageData(sample.width, sample.height)
  image.data.set(sample.pixels)
  context.putImageData(image, 0, 0)
}, { immediate: true, flush: 'post' })
</script>

<template>
  <div class="pointer-events-none fixed z-50 w-[148px] border border-ui-border bg-ui-toolbar p-2 text-[10px] text-ui-text shadow-xl" :style="position" aria-live="off">
    <div class="relative mx-auto h-[108px] w-[108px] border border-ui-border bg-[conic-gradient(#bbb_25%,#eee_0_50%,#bbb_0_75%,#eee_0)] bg-[length:16px_16px]">
      <canvas ref="pixelsCanvas" :width="sample.width" :height="sample.height" class="h-full w-full [image-rendering:pixelated]" />
      <div class="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 border border-ui-border shadow-[0_0_0_1px_#000]" />
    </div>
    <div class="mt-1 flex items-center gap-1.5">
      <span class="h-4 w-4 shrink-0 border border-ui-border" :style="{ backgroundColor: colorRgba(sample.color) }" />
      <span class="font-mono">{{ colorHex(sample.color) }}</span>
    </div>
    <div class="font-mono text-ui-secondary-text">{{ colorRgba(sample.color) }}</div>
    <div class="text-ui-secondary-text">{{ Math.floor(sample.x + sample.width / 2) }}, {{ Math.floor(sample.y + sample.height / 2) }} px</div>
  </div>
</template>
