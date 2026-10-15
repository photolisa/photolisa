<script setup lang="ts">
import { ref, nextTick, onMounted, watch } from 'vue'
import { rasterSources } from '~/raster/RasterSourceRegistry'

const props = defineProps<{ sourceId: string; revision: number }>()
const canvas = ref<HTMLCanvasElement | null>(null)
function draw(): void {
  const source = rasterSources.get(props.sourceId)
  const context = canvas.value?.getContext('2d')
  if (!source || !context) return
  context.clearRect(0, 0, 28, 28)
  context.drawImage(source.image, 0, 0, 28, 28)
}
onMounted(draw)
watch(() => [props.sourceId, props.revision], () => nextTick(draw))
</script>

<template><canvas ref="canvas" width="28" height="28" class="h-7 w-7 border border-ui-border" aria-hidden="true" /></template>
