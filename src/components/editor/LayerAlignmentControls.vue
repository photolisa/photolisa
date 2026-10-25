<script setup lang="ts">
import { computed } from 'vue'
import { useUiStore } from '../../stores/ui'
import type {
  AlignEdge,
  AlignOperation,
  LayerAlignmentAction,
} from '../../core/transform/LayerAlignment'

const props = defineProps<{ count: number }>()
const emit = defineEmits<{ action: [action: LayerAlignmentAction] }>()
const ui = useUiStore()
const effectiveTarget = computed(() =>
  props.count < 2 ? 'canvas' : ui.layerAlignmentReference,
)
const edges: { action: AlignEdge; label: string }[] = [
  { action: 'left', label: 'Align left' },
  { action: 'center-x', label: 'Align horizontal centers' },
  { action: 'right', label: 'Align right' },
  { action: 'top', label: 'Align top' },
  { action: 'center-y', label: 'Align vertical centers' },
  { action: 'bottom', label: 'Align bottom' },
]
const distribution: { action: AlignOperation; label: string }[] = [
  { action: 'distribute-x', label: 'Distribute horizontal centers' },
  { action: 'distribute-y', label: 'Distribute vertical centers' },
  { action: 'spacing-x', label: 'Equal horizontal spacing' },
  { action: 'spacing-y', label: 'Equal vertical spacing' },
]
</script>

<template>
  <div class="text-[11px]">
    <label class="mb-2 flex items-center justify-between gap-2">
      Align to
      <select
        :value="effectiveTarget"
        :disabled="count < 2"
        aria-label="Alignment reference"
        class="bg-ui-elevated border-ui-border rounded border px-1 py-1"
        @change="
          ui.layerAlignmentReference =
            ($event.target as HTMLSelectElement).value === 'canvas'
              ? 'canvas'
              : 'selection'
        "
      >
        <option value="selection">Selection</option>
        <option value="canvas">Canvas</option>
      </select>
    </label>
    <div class="grid grid-cols-1 gap-0.5">
      <button
        v-for="item in edges"
        :key="item.action"
        class="hover:bg-ui-hover focus-visible:outline-accent rounded px-2 py-1 text-left focus-visible:outline"
        @click="
          emit(
            'action',
            `${effectiveTarget === 'canvas' ? 'canvas' : 'align'}-${item.action}`,
          )
        "
      >
        {{ item.label }}
      </button>
    </div>
    <div class="border-ui-border mt-2 grid grid-cols-1 gap-0.5 border-t pt-2">
      <button
        v-for="item in distribution"
        :key="item.action"
        :disabled="count < 3"
        :title="
          count < 3
            ? 'Select at least three unlocked layers'
            : 'Keep the outer layers fixed'
        "
        class="hover:enabled:bg-ui-hover focus-visible:outline-accent rounded px-2 py-1 text-left focus-visible:outline disabled:opacity-35"
        @click="emit('action', `align-${item.action}`)"
      >
        {{ item.label }}
      </button>
    </div>
  </div>
</template>
