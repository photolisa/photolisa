<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import { filterRegistry } from '~/core/filters/FilterRegistry'
import { EFFECT_CATEGORIES } from '~/core/filters/EffectCatalog'
import { effectCategory } from '~/ui/effectSchemas'
import type { AdjustmentKind, PixelBuffer } from '~/core/filters/types'
import type { Layer } from '~/core/model/types'
import { rasterSources } from '~/raster/RasterSourceRegistry'
import { AdjustmentWorkerClient } from '~/raster/AdjustmentWorkerClient'
import samplePhoto from '~/assets/img/monalisa-app.png'
import EffectPreview from './EffectPreview.vue'
const props = defineProps<{ layer: Layer | null; initialCategory: string }>()
const emit = defineEmits<{ select: [kind: AdjustmentKind] }>()
const search = ref(''), category = ref(props.initialCategory)
const thumbnails = shallowRef<Partial<Record<AdjustmentKind, PixelBuffer>>>({})
const worker = new AdjustmentWorkerClient()
let version = 0
const definitions = computed(() => filterRegistry.list().filter(def => (category.value === 'All' || effectCategory(def.kind) === category.value) && `${def.label} ${def.kind === 'grayscale' ? 'Black & White black-and-white' : ''} ${effectCategory(def.kind)}`.toLowerCase().includes(search.value.toLowerCase())))
async function generate(): Promise<void> {
  const current = ++version, canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 52
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return
  const layer = props.layer, source = layer?.kind === 'raster' && layer.pixelSourceId ? rasterSources.get(layer.pixelSourceId) : null
  if (source) context.drawImage(source.image, 0, 0, 80, 52)
  else {
    const image = new Image(); image.src = samplePhoto
    try { await image.decode(); context.drawImage(image, 0, 0, 80, 52) } catch { return }
  }
  const image = context.getImageData(0, 0, 80, 52), input = { data: image.data, width: 80, height: 52 }
  for (const def of definitions.value) {
    if (current !== version) return
    try {
      const effect = filterRegistry.create(def.kind)
      const parameters = effect.parameters as unknown as Record<string, number>
      // Neutral adjustments need a visible demonstration in the library only.
      if (def.kind === 'brightness-contrast') { parameters.brightness = 0.15; parameters.contrast = 0.2 }
      if (def.kind === 'exposure') parameters.stops = 0.8
      if (['saturation', 'temperature', 'tint', 'vibrance'].includes(def.kind)) parameters.amount = 0.6
      if (def.kind === 'gamma') parameters.gamma = 1.5
      if (def.kind === 'hue') parameters.degrees = 45
      if (def.kind === 'tone-range') { parameters.shadows = 0.6; parameters.highlights = -0.3 }
      if (def.kind === 'whites-blacks') { parameters.whites = 0.5; parameters.blacks = -0.4 }
      if (def.kind === 'color-balance') { parameters.red = 0.5; parameters.blue = -0.3 }
      if (def.kind === 'selective-color') parameters.cyan = 0.7
      const result = await worker.process(input, [effect])
      if (current === version) thumbnails.value = { ...thumbnails.value, [def.kind]: result }
    } catch { /* A failed thumbnail must not prevent opening its full-resolution controls. */ }
  }
}
watch(() => [props.layer?.id, category.value, search.value], () => { void generate() }, { immediate: true })
onUnmounted(() => { version++; worker.destroy() })
</script>
<template>
  <section aria-label="Effects library">
    <input v-model="search" type="search" aria-label="Search effects" placeholder="Search effects…" class="h-8 w-full rounded-lg border border-ui-border bg-ui-elevated px-3 text-xs outline-none focus:border-accent">
    <select v-model="category" aria-label="Effect category" class="my-2 h-8 w-full rounded-lg border border-ui-border bg-ui-elevated px-2 text-xs"><option>All</option><option v-for="item in EFFECT_CATEGORIES" :key="item">{{ item }}</option></select>
    <div class="grid grid-cols-3 gap-2">
      <button v-for="def in definitions" :key="def.kind" class="overflow-hidden rounded-lg border border-ui-border bg-ui-elevated text-left hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" :title="`${effectCategory(def.kind)} · ${def.label}`" :aria-label="`Preview ${def.label}`" @click="emit('select', def.kind)">
        <EffectPreview v-bind="thumbnails[def.kind] ? { pixels: thumbnails[def.kind] } : {}" /><span class="block min-h-8 px-1.5 py-1 text-[10px] leading-tight">{{ def.label === 'Grayscale' ? 'Black & White' : def.label }}</span>
      </button>
    </div>
    <p v-if="!definitions.length" class="py-6 text-center text-xs text-ui-secondary-text">No effects match your search.</p>
  </section>
</template>
