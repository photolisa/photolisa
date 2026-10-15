<script setup lang="ts">
import { useUiStore } from '../../stores/ui'
import { readSubpaths } from '../../core/vector/PathGeometry'
import { computed, onBeforeUnmount, ref } from 'vue'
import type { VectorLayer, VectorStyle } from '../../core/model/types'
import { editorCore } from '../../composables/useEditor'
import { SetVectorStyleCommand } from '../../core/commands/VectorCommands'
import { VectorStylePreview } from '../../core/vector/VectorStylePreview'
const props = defineProps<{ layer: VectorLayer; revision: number }>()
const ui = useUiStore()
function samplePaint(target: 'fill' | 'stroke'): void {
  if (props.layer.locked || !editorCore.document) return
  ui.vectorPaintTarget = {
    documentId: editorCore.document.id,
    layerId: props.layer.id,
    target,
    returnTool: ui.activeTool,
  }
  ui.setTool('eyedropper')
}
const isClosed = computed(() => { void props.revision; return readSubpaths(props.layer.geometry).every(path => path.closed) })
const error = ref('')
function replaceStyle(style: VectorStyle): void {
  if (props.layer.locked) return
  try {
    editorCore.execute(new SetVectorStyleCommand(props.layer.id, style))
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Invalid paint'
  }
}
function change(patch: Partial<VectorStyle>): void {
  replaceStyle({ ...props.layer.style, ...patch })
}
const preview = new VectorStylePreview()
function live(patch: Partial<VectorStyle>): void {
  try {
    preview.update(editorCore, props.layer.id, patch)
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Invalid paint'
  }
}
function commitLive(): void {
  preview.commit()
}
onBeforeUnmount(() => preview.cancel())
function fillMode(event: Event): void {
  const mode = (event.target as HTMLSelectElement).value
  const style = structuredClone(props.layer.style)
  delete style.fillGradient
  if (mode === 'none') style.fill = null
  else if (mode === 'solid') style.fill = style.fill ?? '#000000'
  else
    style.fillGradient = {
      type: mode as 'linear' | 'radial',
      start: { x: mode === 'radial' ? 0.5 : 0, y: 0.5 },
      end: { x: 1, y: 0.5 },
      stops: [
        { offset: 0, color: style.fill ?? '#000000' },
        { offset: 1, color: '#ffffff' },
      ],
    }
  replaceStyle(style)
}
function stop(index: number, field: 'offset' | 'color', event: Event): void {
  const gradient = structuredClone(props.layer.style.fillGradient)
  if (!gradient) return
  const value = (event.target as HTMLInputElement).value
  if (field === 'offset') gradient.stops[index]!.offset = Number(value)
  else gradient.stops[index]!.color = value
  change({ fillGradient: gradient })
}
function addStop(): void {
  const g = structuredClone(props.layer.style.fillGradient)
  if (g && g.stops.length < 64) {
    g.stops.push({ offset: 0.5, color: '#808080' })
    g.stops.sort((a, b) => a.offset - b.offset)
    change({ fillGradient: g })
  }
}
function removeStop(index: number): void {
  const g = structuredClone(props.layer.style.fillGradient)
  if (g && g.stops.length > 2) {
    g.stops.splice(index, 1)
    change({ fillGradient: g })
  }
}
function gradientPosition(
  point: 'start' | 'end',
  axis: 'x' | 'y',
  event: Event,
): void {
  const g = structuredClone(props.layer.style.fillGradient)
  if (g) {
    g[point][axis] = Number((event.target as HTMLInputElement).value)
    change({ fillGradient: g })
  }
}
function gradientAngle(event: Event): void {
  const g = structuredClone(props.layer.style.fillGradient)
  if (g) {
    const radians =
      (Number((event.target as HTMLInputElement).value) * Math.PI) / 180
    g.end = {
      x: g.start.x + Math.cos(radians),
      y: g.start.y + Math.sin(radians),
    }
    change({ fillGradient: g })
  }
}
function dash(event: Event): void {
  const value = (event.target as HTMLInputElement).value.trim()
  change({ strokeDash: value ? value.split(/[\s,]+/).map(Number) : [] })
}
</script>
<template>
  <div class="space-y-2" aria-label="Vector paint">
    <label class="property-row"><span>Fill type</span><select
      class="property-input"
      aria-label="Vector fill type"
      :disabled="layer.locked"
      :value="
        layer.style.fillGradient?.type ??
          (layer.style.fill ? 'solid' : 'none')
      "
      @change="fillMode"
    >
      <option value="none">Transparent</option>
      <option value="solid">Solid</option>
      <option value="linear">Linear gradient</option>
      <option value="radial">Radial gradient</option>
    </select></label>
    <label v-if="!layer.style.fillGradient" class="property-row"><span>Fill</span><input
      class="property-input"
      aria-label="Vector fill color"
      :disabled="layer.locked"
      :value="layer.style.fill ?? 'none'"
      @change="
        change({
          fill:
            ($event.target as HTMLInputElement).value === 'none'
              ? null
              : ($event.target as HTMLInputElement).value,
        })
      "
    /></label>
    <template v-if="layer.style.fillGradient">
      <div
        v-for="(item, index) in layer.style.fillGradient.stops"
        :key="index"
        class="flex items-center gap-1"
      >
        <input
          class="h-6 w-8"
          type="color"
          :disabled="layer.locked"
          :aria-label="`Gradient stop ${index + 1} color`"
          :value="item.color"
          @change="stop(index, 'color', $event)"
        /><input
          class="property-input w-14"
          type="number"
          min="0"
          max="1"
          step="0.01"
          :disabled="layer.locked"
          :aria-label="`Gradient stop ${index + 1} position`"
          :value="item.offset"
          @change="stop(index, 'offset', $event)"
        /><button
          :disabled="layer.locked || layer.style.fillGradient.stops.length <= 2"
          :aria-label="`Remove gradient stop ${index + 1}`"
          @click="removeStop(index)"
        >
          −
        </button>
      </div>
      <button
        class="border border-ui-border px-2 py-1"
        :disabled="layer.locked || layer.style.fillGradient.stops.length >= 64"
        @click="addStop"
      >
        Add gradient stop
      </button>
      <label class="property-row"><span>Angle</span><input
        class="property-input"
        type="number"
        :disabled="layer.locked"
        :value="
          Math.round(
            (Math.atan2(
              layer.style.fillGradient.end.y -
                layer.style.fillGradient.start.y,
              layer.style.fillGradient.end.x -
                layer.style.fillGradient.start.x,
            ) *
              180) /
              Math.PI,
          )
        "
        aria-label="Gradient angle"
        @change="gradientAngle"
      /></label>
      <div class="grid grid-cols-2 gap-1">
        <label
          v-for="[point, axis] in [
            ['start', 'x'],
            ['start', 'y'],
            ['end', 'x'],
            ['end', 'y'],
          ] as const"
          :key="point + axis"
          class="flex items-center gap-1"
        ><span>{{ point }} {{ axis }}</span><input
          class="property-input w-12"
          type="number"
          step="0.05"
          :disabled="layer.locked"
          :value="layer.style.fillGradient[point][axis]"
          @change="gradientPosition(point, axis, $event)"
        /></label>
      </div>
    </template>
    <div class="flex gap-2">
      <button
        :disabled="layer.locked"
        class="border border-ui-border px-2 py-1"
        @click="samplePaint('fill')"
      >
        Sample fill</button><button
        :disabled="layer.locked"
        class="border border-ui-border px-2 py-1"
        @click="samplePaint('stroke')"
      >
        Sample stroke
      </button>
    </div>
    <label class="property-row"><span>Fill opacity</span><input
      type="range"
      min="0"
      max="1"
      step="0.01"
      :disabled="layer.locked"
      :value="layer.style.fillOpacity ?? 1"
      aria-label="Vector fill opacity"
      @input="
        live({
          fillOpacity: Number(($event.target as HTMLInputElement).value),
        })
      "
      @change="commitLive"
    /></label>
    <label class="property-row"><span>Fill rule</span><select
      class="property-input"
      :disabled="layer.locked"
      :value="layer.style.fillRule"
      @change="
        change({
          fillRule: ($event.target as HTMLSelectElement)
            .value as VectorStyle['fillRule'],
        })
      "
    >
      <option value="nonzero">Nonzero</option>
      <option value="evenodd">Even odd</option>
    </select></label>
    <label class="property-row"><span>Stroke</span><input
      class="property-input"
      aria-label="Vector stroke color"
      :disabled="layer.locked"
      :value="layer.style.stroke ?? 'none'"
      @change="
        change({
          stroke:
            ($event.target as HTMLInputElement).value === 'none'
              ? null
              : ($event.target as HTMLInputElement).value,
        })
      "
    /></label>
    <label class="property-row"><span>Width</span><input
      class="property-input"
      type="number"
      min="0"
      max="10000"
      step="0.1"
      aria-label="Vector stroke width"
      :disabled="layer.locked"
      :value="layer.style.strokeWidth"
      @change="
        change({
          strokeWidth: Number(($event.target as HTMLInputElement).value),
        })
      "
    /></label>
    <label class="property-row"><span>Stroke opacity</span><input
      type="range"
      min="0"
      max="1"
      step="0.01"
      :disabled="layer.locked"
      :value="layer.style.strokeOpacity ?? 1"
      @input="
        live({
          strokeOpacity: Number(($event.target as HTMLInputElement).value),
        })
      "
      @change="commitLive"
    /></label>
    <label class="property-row"><span>Alignment</span><select
      aria-label="Vector stroke alignment"
      class="property-input"
      :disabled="layer.locked || !isClosed"
      :value="layer.style.strokeAlignment ?? 'center'"
      @change="
        change({
          strokeAlignment: ($event.target as HTMLSelectElement)
            .value as NonNullable<VectorStyle['strokeAlignment']>,
        })
      "
    >
      <option>inside</option>
      <option>center</option>
      <option>outside</option>
    </select></label>
    <label class="property-row"><span>Cap</span><select
      class="property-input"
      :disabled="layer.locked"
      :value="layer.style.strokeCap ?? 'butt'"
      @change="
        change({
          strokeCap: ($event.target as HTMLSelectElement)
            .value as NonNullable<VectorStyle['strokeCap']>,
        })
      "
    >
      <option>butt</option>
      <option>round</option>
      <option>square</option>
    </select></label>
    <label class="property-row"><span>Join</span><select
      class="property-input"
      :disabled="layer.locked"
      :value="layer.style.strokeJoin ?? 'miter'"
      @change="
        change({
          strokeJoin: ($event.target as HTMLSelectElement)
            .value as NonNullable<VectorStyle['strokeJoin']>,
        })
      "
    >
      <option>miter</option>
      <option>round</option>
      <option>bevel</option>
    </select></label>
    <label class="property-row"><span>Stroke style</span><select class="property-input" :disabled="layer.locked" :value="!layer.style.strokeDash?.length ? 'solid' : layer.style.strokeDash.join(' ') === '8 4' ? 'dashed' : layer.style.strokeDash.join(' ') === '1 4' ? 'dotted' : 'custom'" @change="change({ strokeDash: ($event.target as HTMLSelectElement).value === 'solid' ? [] : ($event.target as HTMLSelectElement).value === 'dashed' ? [8, 4] : ($event.target as HTMLSelectElement).value === 'dotted' ? [1, 4] : [12, 3, 2, 3], ...(($event.target as HTMLSelectElement).value === 'dotted' ? { strokeCap: 'round' as const } : {}) })"><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option><option value="custom">Custom</option></select></label>
    <label class="property-row"><span>Dashes</span><input
      class="property-input"
      aria-label="Stroke dash pattern"
      placeholder="e.g. 8 4, or 1 4 for dots"
      :disabled="layer.locked"
      :value="layer.style.strokeDash?.join(' ') ?? ''"
      @change="dash"
    /></label>
    <label><input
      type="checkbox"
      :disabled="layer.locked"
      :checked="layer.style.scaleStroke !== false"
      @change="
        change({ scaleStroke: ($event.target as HTMLInputElement).checked })
      "
    />
      Scale stroke</label>
    <div class="flex gap-2">
      <label><input
        type="checkbox"
        :disabled="layer.locked"
        :checked="layer.style.startArrow"
        @change="
          change({ startArrow: ($event.target as HTMLInputElement).checked })
        "
      />
        Start arrow</label><label><input
        type="checkbox"
        :disabled="layer.locked"
        :checked="layer.style.endArrow"
        @change="
          change({ endArrow: ($event.target as HTMLInputElement).checked })
        "
      />
        End arrow</label>
    </div>
    <p v-if="error" class="text-danger" role="alert">{{ error }}</p>
  </div>
</template>
