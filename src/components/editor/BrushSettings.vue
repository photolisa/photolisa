<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useUiStore } from '../../stores/ui'
import { BRUSH_PRESETS, brushPreset, resolveBrush } from '../../raster/BrushPresets'
import { dabSpacing, dashVisible, paintBrushDab } from '../../raster/BrushTip'
import { accumulateCoverage } from '../../raster/StrokeMath'

const ui = useUiStore()
const groups = ['Basic', 'Artistic', 'Special'] as const
const preview = ref<HTMLCanvasElement | null>(null)
const selected = computed(() => brushPreset(ui.brush.preset))
const textured = computed(() => ['graphite', 'watercolor', 'bristle', 'charcoal', 'chalk', 'wax'].includes(ui.brush.tip))
function drawPreview(): void {
  const context = preview.value?.getContext('2d')
  if (!context) return
  const width = 280, height = 72
  const image = context.createImageData(width, height)
  const coverage = new Float32Array(width * height)
  const brush = resolveBrush({ ...ui.brush, diameter: Math.min(36, ui.brush.diameter) })
  let index = 0
  for (let distance = 0; distance <= 224; distance += dabSpacing(brush)) {
    if (!dashVisible(brush, distance)) continue
    paintBrushDab(brush, { x: 28 + distance, y: 36 + Math.sin(distance / 224 * Math.PI * 2) * 10,
      pressure: .3 + .7 * Math.sin(distance / 224 * Math.PI), index: index++, seed: 42 }, width, height,
    (x, y, amount) => {
      const pixel = y * width + x
      coverage[pixel] = accumulateCoverage(coverage[pixel] ?? 0, amount)
      const offset = pixel * 4
      image.data[offset] = 225; image.data[offset + 1] = 225; image.data[offset + 2] = 225
      image.data[offset + 3] = Math.round((coverage[pixel] ?? 0) * brush.opacity * 255)
    })
  }
  context.putImageData(image, 0, 0)
}
let previewFrame: number | null = null
function schedulePreview(): void {
  if (previewFrame !== null) cancelAnimationFrame(previewFrame)
  previewFrame = requestAnimationFrame(() => {
    previewFrame = null
    if (preview.value?.closest(':popover-open')) drawPreview()
  })
}
watch(() => ({ ...ui.brush }), schedulePreview)
onBeforeUnmount(() => { if (previewFrame !== null) cancelAnimationFrame(previewFrame) })
</script>

<template>
  <label class="flex items-center gap-2 text-ui-secondary-text">
    Preset
    <select :value="ui.brush.preset" aria-label="Brush preset" class="max-w-36 rounded border border-ui-border bg-ui-toolbar px-1 py-1 text-ui-text focus-visible:outline-accent" @change="ui.selectBrushPreset(($event.target as HTMLSelectElement).value)">
      <optgroup v-for="group in groups" :key="group" :label="group">
        <option v-for="preset in BRUSH_PRESETS.filter(item => item.group === group)" :key="preset.id" :value="preset.id">{{ preset.name }}</option>
      </optgroup>
    </select>
  </label>
  <button popovertarget="brush-settings" class="rounded border border-ui-border px-2 py-1 hover:bg-ui-hover focus-visible:outline-accent" aria-label="Brush settings">Settings</button>
  <Teleport to="body">
    <div id="brush-settings" popover class="brush-settings rounded-lg border border-ui-border bg-[#1c1c1c] p-4 text-xs text-ui-text shadow-xl" aria-label="Brush settings" @toggle="schedulePreview" @keydown.stop>
      <div class="mb-2 flex items-center justify-between gap-2">
        <strong>{{ selected.name }}</strong>
        <button class="rounded px-2 py-1 hover:bg-ui-hover" popovertarget="brush-settings" popovertargetaction="hide" aria-label="Close brush settings" autofocus>✕</button>
      </div>
      <canvas ref="preview" width="280" height="72" class="mb-2 w-full rounded bg-[#101010]" aria-label="Brush stroke preview" />
      <p class="mb-4 whitespace-normal leading-relaxed text-ui-secondary-text">{{ selected.description }}</p>
      <div class="grid gap-3">
        <label v-if="textured" class="setting">Texture<input v-model.number="ui.brush.texture" aria-label="Brush texture" type="range" min="0" max="1" step="0.01"><output>{{ Math.round(ui.brush.texture * 100) }}%</output></label>
        <label v-if="ui.brush.tip !== 'pixel'" class="setting">Scatter<input v-model.number="ui.brush.scatter" aria-label="Brush scatter" type="range" min="0" max="1" step="0.01"><output>{{ Math.round(ui.brush.scatter * 100) }}%</output></label>
        <template v-if="!['pixel', 'spray', 'splatter'].includes(ui.brush.tip)">
          <label class="setting">Angle<input v-model.number="ui.brush.angle" aria-label="Brush angle" type="range" min="-180" max="180" step="1"><output>{{ ui.brush.angle }}°</output></label>
          <label class="setting">Roundness<input v-model.number="ui.brush.roundness" aria-label="Brush roundness" type="range" min="0.05" max="1" step="0.01"><output>{{ Math.round(ui.brush.roundness * 100) }}%</output></label>
        </template>
        <template v-if="ui.brush.preset === 'dashed'">
          <label class="setting">Dash length<input v-model.number="ui.brush.dashLength" aria-label="Brush dash length" type="range" min="0.25" max="20" step="0.25"><output>{{ ui.brush.dashLength }}×</output></label>
          <label class="setting">Dash gap<input v-model.number="ui.brush.dashGap" aria-label="Brush dash gap" type="range" min="0.25" max="20" step="0.25"><output>{{ ui.brush.dashGap }}×</output></label>
          <span class="text-ui-secondary-text">Dash lengths are multiples of brush size.</span>
        </template>
        <template v-if="ui.brush.tip !== 'pixel'">
          <label class="flex items-center gap-2"><input v-model="ui.brush.pressureSize" type="checkbox" class="accent-accent">Pen pressure controls size</label>
          <label class="flex items-center gap-2"><input v-model="ui.brush.pressureFlow" type="checkbox" class="accent-accent">Pen pressure controls ink strength</label>
          <span class="text-ui-secondary-text">A mouse uses constant pressure.</span>
        </template>
        <button class="mt-1 rounded border border-ui-border px-2 py-1.5 hover:bg-ui-hover" @click="ui.selectBrushPreset(ui.brush.preset)">Reset preset settings</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
@reference "../../assets/css/main.css";
.brush-settings { position: fixed; inset: 88px auto auto 112px; margin: 0; width: 312px; max-width: calc(100vw - 24px); max-height: calc(100vh - 110px); overflow-y: auto; }
.setting { display: grid; grid-template-columns: 86px 1fr 40px; align-items: center; gap: 8px; }
.setting input { min-width: 0; width: 100%; @apply accent-accent; }
.setting output { text-align: right; }
</style>
