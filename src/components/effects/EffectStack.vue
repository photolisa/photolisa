<script setup lang="ts">
import { filterRegistry } from '~/core/filters/FilterRegistry'
import type { LayerAdjustment } from '~/core/filters/types'
import EditorIcon from '../editor/Icon.vue'
defineProps<{ effects: readonly LayerAdjustment[]; selectedId: string | null }>()
const emit = defineEmits<{ edit: [id: string]; toggle: [id: string]; remove: [id: string]; move: [id: string, delta: number] }>()
</script>
<template>
  <section aria-label="Effect stack" class="space-y-1">
    <p v-if="!effects.length" class="py-3 text-xs text-ui-secondary-text">Choose an effect to preview it on the canvas.</p>
    <div v-for="(effect, index) in effects" :key="effect.id" class="flex h-8 items-center gap-1 rounded-lg border bg-ui-elevated px-1" :class="selectedId === effect.id ? 'border-accent' : 'border-ui-border'">
      <button class="stack-icon" :aria-label="`${effect.enabled ? 'Disable' : 'Enable'} ${filterRegistry.get(effect.kind).label}`" @click="emit('toggle', effect.id)"><EditorIcon :name="effect.enabled ? 'eye' : 'eye-off'" :size="14" /></button>
      <button class="min-w-0 flex-1 truncate text-left text-[11px]" :class="effect.enabled ? 'text-ui-text' : 'text-ui-muted'" @click="emit('edit', effect.id)">{{ filterRegistry.get(effect.kind).label }}</button>
      <button class="stack-icon" aria-label="Move effect up" :disabled="index === 0" @click="emit('move', effect.id, -1)"><EditorIcon name="arrow-up" :size="13" /></button>
      <button class="stack-icon" aria-label="Move effect down" :disabled="index === effects.length - 1" @click="emit('move', effect.id, 1)"><EditorIcon name="arrow-down" :size="13" /></button>
      <button class="stack-icon" :aria-label="`Remove ${filterRegistry.get(effect.kind).label}`" @click="emit('remove', effect.id)"><EditorIcon name="x" :size="14" /></button>
    </div>
  </section>
</template>
<style scoped>
@reference "../../assets/css/main.css";
.stack-icon { @apply grid h-6 w-5 shrink-0 place-items-center rounded text-ui-secondary-text hover:bg-ui-hover hover:text-ui-text disabled:opacity-20; }
</style>
