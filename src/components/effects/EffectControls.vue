<script setup lang="ts">
import { effectControls } from '~/ui/effectSchemas'
import { EFFECT_BLEND_MODES } from '~/core/filters/EffectPipeline'
import type { LayerAdjustment } from '~/core/filters/types'
const props = defineProps<{ effect: LayerAdjustment }>()
const emit = defineEmits<{ parameter: [key: string, value: number]; opacity: [value: number]; blend: [value: LayerAdjustment['blendMode']]; lut: [file: File] }>()
const value = (key: string) => Number((props.effect.parameters as unknown as Record<string, number>)[key] ?? 0)
function numeric(key: string, event: Event): void {
  const input = event.target as HTMLInputElement
  if (!input.value.trim() || !Number.isFinite(input.valueAsNumber)) return
  emit('parameter', key, input.valueAsNumber)
}
function opacity(event: Event): void { const input = event.target as HTMLInputElement; if (input.value.trim() && Number.isFinite(input.valueAsNumber)) emit('opacity', input.valueAsNumber / 100) }
function file(event: Event): void { const input = event.target as HTMLInputElement; const selected = input.files?.item(0); if (selected) emit('lut', selected); input.value = '' }
</script>
<template>
  <section class="space-y-3" aria-label="Effect parameters">
    <div v-for="control in effectControls(effect.kind)" :key="control.key" class="space-y-1">
      <div class="flex items-center justify-between gap-3 text-[11px]">
        <label :for="`effect-${effect.id}-${control.key}`" class="text-ui-secondary-text">{{ control.label }}</label>
        <input v-if="control.color" :id="`effect-${effect.id}-${control.key}`" type="color" class="h-7 w-16 rounded border border-ui-border bg-ui-elevated" :value="`#${Math.round(value(control.key)).toString(16).padStart(6, '0')}`" @input="emit('parameter', control.key, parseInt(($event.target as HTMLInputElement).value.slice(1), 16))">
        <input v-else :id="`effect-${effect.id}-${control.key}`" class="h-6 w-20 rounded border border-ui-border bg-ui-elevated px-2 text-right text-ui-text" type="number" :min="control.min" :max="control.max" :step="control.step" :value="value(control.key)" @input="numeric(control.key, $event)">
      </div>
      <input v-if="!control.color" class="block h-3 w-full accent-accent" type="range" :aria-label="`${control.label} slider`" :min="control.min" :max="control.max" :step="control.step" :value="value(control.key)" @input="numeric(control.key, $event)">
    </div>
    <div class="grid grid-cols-2 gap-3 border-t border-ui-border pt-3 text-[11px]">
      <label class="space-y-1"><span class="text-ui-secondary-text">Effect opacity (%)</span><input class="h-7 w-full rounded border border-ui-border bg-ui-elevated px-2" type="number" min="0" max="100" step="1" :value="Math.round((effect.opacity ?? 1) * 100)" @input="opacity"></label>
      <label class="space-y-1"><span class="text-ui-secondary-text">Effect blend mode</span><select class="h-7 w-full rounded border border-ui-border bg-ui-elevated px-1" :value="effect.blendMode ?? 'normal'" @change="emit('blend', ($event.target as HTMLSelectElement).value as LayerAdjustment['blendMode'])"><option v-for="mode in EFFECT_BLEND_MODES" :key="mode" :value="mode">{{ mode }}</option></select></label>
    </div>
    <label v-if="effect.kind === 'color-lookup'" class="block text-[11px] text-ui-secondary-text">Load 3D LUT (.cube)<input class="mt-2 block w-full text-xs" type="file" accept=".cube" @change="file"><span class="mt-1 block">{{ effect.lut?.size ?? 2 }}³ cube · RGB domain 0–1</span></label>
    <p v-if="effect.selection" class="text-[10px] text-accent">This effect is restricted to a saved selection.</p>
  </section>
</template>
