<script setup lang="ts">
import { ref, watch } from 'vue'
import type { PixelBuffer } from '~/core/filters/types'
const props = defineProps<{ pixels?: PixelBuffer }>()
const canvas = ref<HTMLCanvasElement | null>(null)
watch(() => [props.pixels, canvas.value] as const, () => {
  const p = props.pixels, target = canvas.value
  if (!p || !target) return
  target.width = p.width; target.height = p.height
  target.getContext('2d')?.putImageData(new ImageData(p.data, p.width, p.height), 0, 0)
}, { flush: 'post', immediate: true })
</script>
<template><canvas ref="canvas" width="80" height="52" class="block aspect-[80/52] w-full rounded-t-lg bg-ui-workspace object-cover" aria-hidden="true" /></template>
