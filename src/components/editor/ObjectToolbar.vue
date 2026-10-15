<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { CanvasAction, CanvasControls } from '~/tools/ObjectManipulation'
import { useUiStore } from '~/stores/ui'
const props = defineProps<{
  controls: CanvasControls
  vectorPaint?: { fill: string; stroke: string } | null
}>()
const emit = defineEmits<{
  action: [action: CanvasAction]
  paint: [target: 'fill' | 'stroke', value: string]
}>()
const ui = useUiStore()
const element = ref<HTMLElement | null>(null)
const size = ref({
  width: 320,
  height: 34,
  parentWidth: 800,
  parentHeight: 600,
})
let observer: ResizeObserver | null = null
onMounted(() => {
  observer = new ResizeObserver(() => {
    const el = element.value
    if (el?.parentElement)
      size.value = {
        width: el.offsetWidth,
        height: el.offsetHeight,
        parentWidth: el.parentElement.clientWidth,
        parentHeight: el.parentElement.clientHeight,
      }
  })
  if (element.value) {
    observer.observe(element.value)
    if (element.value.parentElement)
      observer.observe(element.value.parentElement)
  }
})
onUnmounted(() => observer?.disconnect())
const position = computed(() => ({
  left: `${Math.max(8, Math.min(props.controls.x, size.value.parentWidth - size.value.width - 8))}px`,
  top: `${Math.max(8, Math.min(props.controls.y, size.value.parentHeight - size.value.height - 8))}px`,
}))
function guides(value: string): number[] {
  return value
    .split(',')
    .filter((s) => s.trim())
    .map(Number)
    .filter((n) => Number.isFinite(n) && Math.abs(n) <= 1000000)
    .slice(0, 100)
}
const menu = ref<'arrange' | 'transform' | null>(null)
function run(action: CanvasAction): void {
  menu.value = null
  emit('action', action)
}
</script>
<template>
  <div
    ref="element"
    role="toolbar"
    aria-label="Object controls"
    class="object-toolbar bg-ui-toolbar/80 backdrop-blur-sm absolute z-30 flex max-w-[calc(100%_-_16px)] flex-wrap items-center gap-1 rounded-lg border border-ui-border p-1 text-[11px] text-ui-text shadow-xl"
    :style="position"
    @pointerdown.stop
    @keydown.stop
  >
    <button
      v-if="controls.crop"
      aria-label="Finish image crop"
      @click="run('finish-crop')"
    >
      Done crop
    </button>
    <button
      :disabled="controls.locked"
      aria-label="Duplicate objects"
      title="Duplicate objects (Alt-drag also duplicates)"
      @click="run('duplicate')"
    >
      Duplicate
    </button>
    <button
      :disabled="controls.locked"
      aria-label="Delete objects"
      @click="run('delete')"
    >
      Delete
    </button>
    <button aria-label="Lock objects" @click="run('lock')">
      {{ controls.locked ? 'Unlock' : 'Lock' }}
    </button>
    <button
      :disabled="!controls.groupable || controls.locked"
      aria-label="Group objects"
      @click="run('group')"
    >
      Group
    </button>
    <button
      :disabled="controls.locked"
      aria-label="Arrange objects"
      :aria-expanded="menu === 'arrange'"
      @click="menu = menu === 'arrange' ? null : 'arrange'"
    >
      Arrange
    </button>
    <button
      :disabled="controls.locked"
      aria-label="Object transform options"
      :aria-expanded="menu === 'transform'"
      @click="menu = menu === 'transform' ? null : 'transform'"
    >
      Transform
    </button>
    <template v-if="vectorPaint && !controls.locked">
      <label title="Object fill" class="flex items-center gap-1">Fill<input
        aria-label="On-canvas fill"
        type="color"
        :value="vectorPaint.fill"
        @change="
          emit('paint', 'fill', ($event.target as HTMLInputElement).value)
        "
      /></label>
      <label title="Object stroke" class="flex items-center gap-1">Stroke<input
        aria-label="On-canvas stroke"
        type="color"
        :value="vectorPaint.stroke"
        @change="
          emit('paint', 'stroke', ($event.target as HTMLInputElement).value)
        "
      /></label>
    </template>
    <div
      v-if="menu"
      :style="
        Number.parseFloat(position.top) < 270
          ? {
            top: '100%',
            maxHeight: `${Math.max(80, size.parentHeight - Number.parseFloat(position.top) - size.height - 8)}px`,
          }
          : {
            bottom: '100%',
            maxHeight: `${Math.max(80, Number.parseFloat(position.top) - 8)}px`,
          }
      "
      class="bg-ui-toolbar absolute left-0 my-1 max-h-[calc(100vh-80px)] w-60 overflow-auto rounded-lg border border-ui-border p-2 shadow-xl"
    >
      <template v-if="menu === 'arrange'">
        <button class="w-full text-left" @click="run('front')">
          Bring to front
        </button>
        <button class="w-full text-left" @click="run('back')">
          Send to back
        </button>
      </template>
      <template v-else>
        <button class="w-full text-left" @click="run('flip-x')">
          Flip horizontal
        </button>
        <button class="w-full text-left" @click="run('flip-y')">
          Flip vertical
        </button>
        <label class="mt-2 flex items-center justify-between">Lock aspect ratio<input
          :checked="controls.aspectLocked"
          type="checkbox"
          aria-label="Lock object aspect ratio"
          @change="run('aspect')"
        /></label>
        <label class="mt-2 flex items-center justify-between">Snap<input
          v-model="ui.moveSnapToCanvas"
          type="checkbox"
          aria-label="Enable object snapping"
        /></label>
        <label class="mt-2 flex items-center justify-between">Tolerance (screen px)<input
          v-model.number="ui.objectSnapping.tolerance"
          type="number"
          min="0"
          max="40"
          aria-label="Snap tolerance"
          class="bg-ui-elevated w-14"
        /></label>
        <label class="mt-2 flex items-center justify-between">Grid (document px)<input
          v-model.number="ui.objectSnapping.grid"
          type="number"
          min="0"
          max="1024"
          aria-label="Snap grid size"
          class="bg-ui-elevated w-14"
        /></label>
        <label class="mt-2 flex items-center justify-between">Vertical guides<input
          :value="ui.objectSnapping.guidesX.join(', ')"
          aria-label="Vertical canvas guides"
          class="bg-ui-elevated w-24"
          @change="
            ui.objectSnapping.guidesX = guides(
              ($event.target as HTMLInputElement).value,
            )
          "
        /></label>
        <label class="mt-2 flex items-center justify-between">Horizontal guides<input
          :value="ui.objectSnapping.guidesY.join(', ')"
          aria-label="Horizontal canvas guides"
          class="bg-ui-elevated w-24"
          @change="
            ui.objectSnapping.guidesY = guides(
              ($event.target as HTMLInputElement).value,
            )
          "
        /></label>
        <label class="mt-2 flex items-center justify-between">Transform origin<select
          aria-label="On-canvas transform origin"
          class="bg-ui-elevated"
          :value="`${ui.transformOrigin.x},${ui.transformOrigin.y}`"
          @change="
            ui.transformOrigin = {
              x: Number(
                ($event.target as HTMLSelectElement).value.split(',')[0],
              ),
              y: Number(
                ($event.target as HTMLSelectElement).value.split(',')[1],
              ),
            }
          "
        >
          <option value="0.5,0.5">Center</option>
          <option value="0,0">Top left</option>
          <option value="1,0">Top right</option>
          <option value="1,1">Bottom right</option>
          <option value="0,1">Bottom left</option>
        </select></label>
        <label class="mt-2 flex items-center justify-between">Text resize<select
          v-model="ui.textResizeMode"
          aria-label="Text resize behavior"
          class="bg-ui-elevated"
        >
          <option value="box">Text box</option>
          <option value="scale">Scale font</option>
        </select></label>
        <p class="mt-2 text-ui-secondary-text">
          Shift: proportional / 15° rotation<br />Alt: resize from center<br />Ctrl-drag
          handle: skew<br />Ctrl+Alt-drag corner: affine free transform
        </p>
      </template>
    </div>
  </div>
</template>
<style scoped>
button {
  padding: 5px 6px;
  border-radius: 4px;
  white-space: nowrap;
}
button:hover:enabled {
  background: var(--color-ui-hover);
}
button:disabled {
  opacity: 0.35;
}
input[type='color'] {
  width: 20px;
  height: 20px;
  padding: 0;
  background: transparent;
  border: 0;
}
</style>
