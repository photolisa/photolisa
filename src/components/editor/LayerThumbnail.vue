<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import type { EditorDocument } from '~/core/model/EditorDocument'
import type { Layer } from '~/core/model/types'
import { LayerThumbnailRenderer } from '~/renderer/LayerThumbnailRenderer'

const props = defineProps<{ layer: Layer; document: EditorDocument; revision: number }>()
const canvas = ref<HTMLCanvasElement | null>(null)
const renderer = new LayerThumbnailRenderer()

function render(): void {
  if (canvas.value) renderer.render(canvas.value, props.layer, props.document)
}

onMounted(render)
watch(() => props.revision, render)
</script>

<template>
  <canvas ref="canvas" class="h-10 w-10 shrink-0 border border-ui-border" :aria-label="`${layer.name} thumbnail`" />
</template>
