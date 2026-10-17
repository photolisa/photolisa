<script setup lang="ts">
import { ref } from 'vue'
import EditorIcon from './Icon.vue'
import { useDialogFocus } from '~/composables/useDialogFocus'
import { editorTools } from '~/ui/editorTools'

defineProps<{ section: 'about' | 'shortcuts' }>()
const emit = defineEmits<{ close: [] }>()
const surface = ref<HTMLElement | null>(null)
useDialogFocus(surface)

const groups = [
  { label: 'Documents', shortcuts: [['New document', 'Ctrl+N'], ['Open file', 'Ctrl+O'], ['Save project', 'Ctrl+S'], ['Close project', 'Ctrl+W'], ['Next project', 'Ctrl+Tab'], ['Previous project', 'Ctrl+Shift+Tab']] },
  { label: 'Editing and view', shortcuts: [['Photo Effects', 'Ctrl+Shift+F'], ['Undo', 'Ctrl+Z'], ['Redo', 'Ctrl+Shift+Z'], ['Copy selection', 'Ctrl+C'], ['Cut selection', 'Ctrl+X'], ['Paste pixels', 'Ctrl+V'], ['Delete selection', 'Delete / Backspace'], ['Fit on screen', 'Ctrl+0'], ['Actual size', 'Ctrl+1'], ['Swap colors', 'X'], ['Reset colors', 'D']] },
  { label: 'Tools', shortcuts: [...editorTools.filter(tool => tool.key).map(tool => [tool.label, tool.key]), ['Rectangle', 'U']] },
]
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[70] grid place-items-center bg-black/65 p-4" @mousedown.self="emit('close')" @keydown.stop @keydown.escape.prevent="emit('close')">
      <section ref="surface" class="flex max-h-[85dvh] w-[min(600px,94vw)] flex-col overflow-hidden rounded-xl border border-ui-border bg-ui-panel text-ui-text shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="help-dialog-title" tabindex="-1">
        <header class="flex items-center justify-between border-b border-ui-border px-5 py-3">
          <h1 id="help-dialog-title" class="text-sm font-semibold">{{ section === 'about' ? 'About Photolisa' : 'Keyboard Shortcuts' }}</h1>
          <button class="grid h-7 w-7 place-items-center rounded hover:bg-ui-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" aria-label="Close" @click="emit('close')"><EditorIcon name="x" :size="16" /></button>
        </header>
        <div class="overflow-y-auto p-5 text-xs">
          <div v-if="section === 'about'" class="space-y-3 leading-relaxed">
            <p class="text-lg font-semibold">Photolisa <span class="text-xs font-normal text-ui-secondary-text">Beta</span></p>
            <p>A browser-based photo editor for working with images, layers, text, and vector shapes.</p>
            <p class="text-ui-secondary-text">Create a document or open an image to get started. Save a Photolisa project to keep editing your layers, or export your finished image.</p>
          </div>
          <template v-else>
            <p class="mb-5 text-ui-secondary-text">On macOS, use Command in place of Ctrl. Tool shortcuts apply when you are not typing in a field.</p>
            <section v-for="group in groups" :key="group.label" class="mb-5 last:mb-0">
              <h2 class="mb-2 font-semibold">{{ group.label }}</h2>
              <dl class="divide-y divide-ui-border">
                <div v-for="[label, keys] in group.shortcuts" :key="label" class="flex items-center justify-between gap-4 py-2">
                  <dt>{{ label }}</dt><dd><kbd class="whitespace-nowrap rounded border border-ui-border bg-ui-elevated px-2 py-0.5 text-ui-secondary-text">{{ keys }}</kbd></dd>
                </div>
              </dl>
            </section>
          </template>
        </div>
      </section>
    </div>
  </Teleport>
</template>
