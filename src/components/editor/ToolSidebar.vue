<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onClickOutside, useEventListener } from '@vueuse/core'
import EditorForegroundBackgroundColors from './ForegroundBackgroundColors.vue'
import EditorIcon from './Icon.vue'
import { editorTools } from '../../ui/editorTools'
import type { ToolId } from '../../stores/ui'

const props = defineProps<{ activeTool: ToolId }>()
const emit = defineEmits<{ select: [tool: ToolId] }>()
const root = ref<HTMLElement | null>(null)
const opened = ref<string | null>(null)
const pinned = ref(false)
const position = ref({ left: '56px', top: '120px' })
const groups: { id: string; tools: ToolId[]; separator?: boolean }[] = [
  { id: 'move', tools: ['move'] },
  { id: 'selection', tools: ['marquee', 'ellipse-marquee', 'lasso'] },
  { id: 'crop', tools: ['crop', 'transform'] },
  { id: 'paint', tools: ['brush', 'pencil'], separator: true },
  { id: 'eraser', tools: ['eraser'] },
  { id: 'fill', tools: ['paint-bucket'] },
  { id: 'retouch', tools: ['clone-stamp', 'spot-repair'] },
  { id: 'text', tools: ['text'], separator: true },
  { id: 'shapes', tools: ['rectangle', 'rounded-rectangle', 'circle', 'ellipse', 'hexagon', 'line', 'polygon', 'triangle', 'star', 'arrow', 'custom-shape'] },
  { id: 'pen', tools: ['pen', 'curvature-pen', 'freeform-pen'] },
  { id: 'paths', tools: ['path-selection', 'direct-selection'] },
  { id: 'sample', tools: ['eyedropper'] },
  { id: 'hand', tools: ['hand'], separator: true },
  { id: 'zoom', tools: ['zoom'] },
]
const remembered = ref<Record<string, ToolId>>({})
watch(() => props.activeTool, (tool) => {
  const group = groups.find((group) => group.tools.includes(tool))
  if (group) remembered.value[group.id] = tool
}, { immediate: true })
function primary(group: typeof groups[number]): ToolId { return remembered.value[group.id] ?? group.tools[0]! }
const secondaryTools = computed(() => editorTools.filter((tool) => !groups.some((group) => primary(group) === tool.id)))
function toolOf(id: ToolId) { return editorTools.find((tool) => tool.id === id)! }
function labelOf(id: ToolId): string {
  const tool = toolOf(id)
  return `${tool.label} tool${tool.key ? ` (${tool.key})` : ''}`
}
function open(id: string, event: MouseEvent | FocusEvent, pin = false): void {
  if (pin && opened.value === id && pinned.value) { close(); return }
  if (pinned.value && !pin) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const count = id === 'more' ? secondaryTools.value.length : groups.find((group) => group.id === id)?.tools.length ?? 1
  position.value = { left: `${rect.right}px`, top: `${Math.max(8, Math.min(rect.top, window.innerHeight - count * 36 - 20))}px` }
  opened.value = id
  pinned.value = pin
}
function close(): void { opened.value = null; pinned.value = false }
function select(id: ToolId): void { emit('select', id); close() }
onClickOutside(root, close)
useEventListener(window, 'keydown', (event) => { if (event.key === 'Escape') close() })
</script>

<template>
  <aside ref="root" class="tool-rail flex w-12 shrink-0 flex-col bg-ui-toolbar" aria-label="Tools">
    <div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-[6px] py-2">
      <div v-for="group in groups" :key="group.id" class="tool-group relative" :class="{ separated: group.separator }" @mouseleave="!pinned && close()">
        <button
          class="tool-button"
          :class="group.tools.includes(activeTool) ? 'selected' : ''"
          :title="toolOf(primary(group)).key ? `${toolOf(primary(group)).label} (${toolOf(primary(group)).key})` : toolOf(primary(group)).label"
          :aria-label="labelOf(primary(group))"
          :aria-pressed="group.tools.includes(activeTool)"
          @mouseenter="group.tools.length > 1 && open(group.id, $event)"
          @click="select(primary(group))"
          @contextmenu.prevent="group.tools.length > 1 && open(group.id, $event, true)"
        ><EditorIcon :name="toolOf(primary(group)).icon" :size="19" /></button>
        <button v-if="group.tools.length > 1" class="group-expander" :aria-label="`More ${group.id} tools`" :aria-expanded="opened === group.id" title="Show tool group" @click="open(group.id, $event, true)"><span /></button>
        <div v-if="opened === group.id" class="tool-flyout" :style="position" :aria-label="`${group.id} tools`">
          <button v-for="id in group.tools.filter((id) => id !== primary(group))" :key="id" class="flyout-item" :class="{ active: activeTool === id }" :aria-label="labelOf(id)" :aria-pressed="activeTool === id" @click="select(id)"><EditorIcon :name="toolOf(id).icon" :size="17" /><span>{{ toolOf(id).label }}</span><kbd>{{ toolOf(id).key }}</kbd></button>
        </div>
      </div>
      <button class="tool-button mt-1" aria-label="More tools" title="More tools" :aria-expanded="opened === 'more'" @click="open('more', $event, true)"><EditorIcon name="ellipsis" :size="20" /></button>
      <div v-if="opened === 'more'" class="tool-flyout" :style="position" aria-label="Additional tools">
        <button v-for="tool in secondaryTools" :key="tool.id" class="flyout-item" :aria-label="labelOf(tool.id)" :aria-pressed="activeTool === tool.id" @click="select(tool.id)"><EditorIcon :name="tool.icon" :size="17" /><span>{{ tool.label }}</span><kbd>{{ tool.key }}</kbd></button>
      </div>
    </div>
    <EditorForegroundBackgroundColors />
  </aside>
</template>

<style scoped>
.tool-button { display: grid; place-items: center; width: 36px; height: 36px; margin-bottom: 2px; border-radius: 7px; color: var(--color-ui-secondary-text); }
.tool-button:hover { background: var(--color-ui-hover); color: var(--color-ui-text); }
.tool-button.selected { background: var(--color-ui-active); color: #fff; box-shadow: inset 0 1px 0 #ffffff20; }
.separated { padding-top: 7px; margin-top: 6px; border-top: 1px solid var(--color-ui-border); }
.group-expander { position: absolute; right: 0; bottom: 2px; width: 13px; height: 13px; display: grid; place-items: center; border-radius: 3px; }
.group-expander span { width: 0; height: 0; border-left: 4px solid transparent; border-bottom: 4px solid var(--color-ui-secondary-text); }
.group-expander:hover { background: var(--color-ui-hover); }
.tool-flyout { position: fixed; z-index: 45; width: min(220px, calc(100vw - 64px)); max-height: calc(100dvh - 16px); overflow: auto; padding: 5px; background: var(--color-ui-panel); border: 1px solid var(--color-ui-border); border-radius: 10px; box-shadow: 0 12px 32px #0006; }
.flyout-item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 36px; padding: 6px 8px; border-radius: 6px; font-size: 12px; text-align: left; color: var(--color-ui-text); }
.flyout-item:hover { background: var(--color-ui-hover); }
.flyout-item.active { background: var(--color-ui-active); color: var(--color-accent); }
kbd { margin-left: auto; font-size: 10px; color: var(--color-ui-secondary-text); }
</style>
