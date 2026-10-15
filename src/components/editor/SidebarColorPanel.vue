<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import EditorColorField from './ColorField.vue'
import { useUiStore } from '../../stores/ui'
import { formatHex, parseHex } from '../../core/colors/ColorManager'
import { colorRgba } from '../../raster/SampledColor'
const ui = useUiStore()
const target = ref<'foreground' | 'background'>('foreground')
const color = computed(() => target.value === 'foreground' ? ui.foregroundColor : ui.secondaryColor)
const hex = ref(formatHex(color.value))
const error = ref('')
watch(color, (value) => { hex.value = formatHex(value); error.value = '' })
function commit(): void {
  try { ui.setColor(target.value, parseHex(hex.value)); error.value = '' }
  catch (reason) { error.value = reason instanceof Error ? reason.message : 'Invalid color' }
}
</script>
<template>
  <details class="sidebar-color border border-ui-border rounded-xl bg-white/5" open>
    <summary class="cursor-pointer px-3 py-2 text-[11px] font-medium text-ui-secondary-text">Color</summary>
    <div class="space-y-2 px-3 pb-3">
      <EditorColorField :color="color" @change="ui.setColor(target, $event)" />
      <div class="flex items-center gap-2">
        <button v-for="item in ['foreground', 'background'] as const" :key="item" class="h-7 w-7 shrink-0 rounded-md border" :class="target === item ? 'border-accent ring-1 ring-accent' : 'border-ui-border'" :style="{ background: colorRgba(item === 'foreground' ? ui.foregroundColor : ui.secondaryColor) }" :aria-label="`${item} color target`" :aria-pressed="target === item" :title="item" @click="target = item" />
        <label class="flex min-w-0 flex-1 items-center gap-2 text-[10px] text-ui-secondary-text">HEX<input v-model="hex" class="h-7 min-w-0 w-full border border-ui-border bg-ui-elevated px-2 font-mono text-xs text-ui-text" aria-label="Sidebar color value" @change="commit" @keydown.enter.prevent="commit"></label>
      </div>
      <p v-if="error" class="text-[11px] text-danger" role="alert">{{ error }}</p>
    </div>
  </details>
</template>
