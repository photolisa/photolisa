<script setup lang="ts">
import { ref, watch } from 'vue'
import { fromHsv, toHsv } from '../../ui/colorField'
import type { ColorValue } from '../../core/colors/ColorManager'
const props = defineProps<{ color: ColorValue }>()
const emit = defineEmits<{ change: [color: ColorValue] }>()
const hsv = ref(toHsv(props.color))
watch(() => props.color, (color) => {
  const next = toHsv(color)
  hsv.value = { ...next, s: next.v === 0 ? hsv.value.s : next.s, h: next.s === 0 || next.v === 0 ? hsv.value.h : next.h }
})
function change(patch: Partial<typeof hsv.value>): void {
  hsv.value = { ...hsv.value, ...patch }
  emit('change', fromHsv(hsv.value, props.color.a))
}
function pick(event: PointerEvent): void {
  const element = event.currentTarget as HTMLElement
  if (event.type === 'pointerdown') element.setPointerCapture(event.pointerId)
  else if (!element.hasPointerCapture(event.pointerId)) return
  const bounds = element.getBoundingClientRect()
  change({ s: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), v: 1 - Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) })
}
function keyboard(event: KeyboardEvent): void {
  const step = event.shiftKey ? 0.1 : 0.01
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault()
    change({ s: Math.max(0, Math.min(1, hsv.value.s + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0))), v: Math.max(0, Math.min(1, hsv.value.v + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0))) })
  }
}
</script>

<template>
  <div class="color-field">
    <div class="color-square" :style="{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }" role="slider" tabindex="0" aria-label="Color saturation and brightness" :aria-valuemin="0" :aria-valuemax="100" :aria-valuenow="Math.round(hsv.v * 100)" :aria-valuetext="`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%; left/right adjusts saturation, up/down adjusts brightness`" @pointerdown="pick" @pointermove="pick" @keydown="keyboard">
      <span class="color-cursor" :style="{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }" />
    </div>
    <input class="hue-slider" type="range" min="0" max="360" step="1" :value="hsv.h" aria-label="Color hue" @input="change({ h: Number(($event.target as HTMLInputElement).value) })">
  </div>
</template>

<style scoped>
.color-square { position: relative; height: 112px; border-radius: 7px; background-image: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent); touch-action: none; cursor: crosshair; }
.color-cursor { position: absolute; width: 10px; height: 10px; border: 2px solid var(--color-ui-text); border-radius: 50%; box-shadow: 0 0 2px 1px #0009; transform: translate(-50%, -50%); pointer-events: none; }
input.hue-slider { width: 100%; height: 8px; margin: 12px 0 6px; appearance: none; border-radius: 6px; background: linear-gradient(to right, red, #ff0, #0f0, #0ff, #00f, #f0f, red); }
.hue-slider::-webkit-slider-thumb { appearance: none; width: 10px; height: 14px; border: 2px solid var(--color-ui-text); border-radius: 4px; background: transparent; box-shadow: 0 0 2px #000; }
.hue-slider::-moz-range-thumb { width: 8px; height: 12px; border: 2px solid var(--color-ui-text); border-radius: 4px; background: transparent; }
</style>
