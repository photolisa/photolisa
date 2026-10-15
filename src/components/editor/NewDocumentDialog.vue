<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import EditorIcon from './Icon.vue'
import type { NewDocumentOptions } from '~/core/model/types'

const emit = defineEmits<{ close: []; create: [options: NewDocumentOptions] }>()
const name = ref('Untitled-1')
const width = ref(1920)
const height = ref(1080)
const resolution = ref(72)
const background = ref<NewDocumentOptions['background']>('transparent')
const error = ref('')
const nameInput = ref<HTMLInputElement | null>(null)

function submit(): void {
  error.value = ''
  if (!name.value.trim()) error.value = 'Enter a document name.'
  else if (!Number.isInteger(width.value) || width.value < 1 || width.value > 16_384) error.value = 'Width must be 1–16,384 px.'
  else if (!Number.isInteger(height.value) || height.value < 1 || height.value > 16_384) error.value = 'Height must be 1–16,384 px.'
  else if (resolution.value < 1 || resolution.value > 2_400) error.value = 'Resolution must be 1–2,400 ppi.'
  if (error.value) return
  emit('create', { name: name.value.trim(), width: width.value, height: height.value, resolution: resolution.value, background: background.value })
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  nameInput.value?.select()
})
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="fixed inset-0 z-50 grid place-items-center bg-black/65" role="presentation" @mousedown.self="emit('close')">
    <form class="w-[460px] border border-ui-border bg-ui-panel shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="new-document-title" @submit.prevent="submit">
      <header class="flex items-center justify-between border-b border-ui-border px-4 py-3">
        <h1 id="new-document-title" class="text-sm font-semibold text-ui-text">New document</h1>
        <button type="button" class="grid h-6 w-6 place-items-center text-ui-secondary-text hover:text-ui-text" aria-label="Close" title="Close" @click="emit('close')"><EditorIcon name="x" :size="16" /></button>
      </header>
      <div class="space-y-4 p-5 text-xs">
        <label class="field"><span>Name</span><input ref="nameInput" v-model="name" type="text" autocomplete="off"></label>
        <div class="grid grid-cols-2 gap-3">
          <label class="field"><span>Width (px)</span><input v-model.number="width" type="number" min="1" max="16384"></label>
          <label class="field"><span>Height (px)</span><input v-model.number="height" type="number" min="1" max="16384"></label>
        </div>
        <label class="field"><span>Resolution (ppi)</span><input v-model.number="resolution" type="number" min="1" max="2400"></label>
        <label class="field"><span>Background</span><select v-model="background"><option value="transparent">Transparent</option><option value="white">White</option></select></label>
        <p v-if="error" class="text-danger" role="alert">{{ error }}</p>
      </div>
      <footer class="flex justify-end gap-2 border-t border-ui-border px-4 py-3">
        <button type="button" class="dialog-button" @click="emit('close')">Cancel</button>
        <button type="submit" class="dialog-button bg-accent text-ui-text hover:bg-accent-hover">Create</button>
      </footer>
    </form>
  </div>
</template>

<style scoped>
@reference "../../assets/css/main.css";
.field { @apply flex flex-col gap-1.5 text-ui-secondary-text; }
.field input, .field select { @apply h-8 border border-ui-border bg-ui-elevated px-2 text-ui-text; }
.dialog-button { @apply min-w-20 border border-ui-border px-3 py-1.5 text-xs text-ui-text hover:bg-ui-hover; }
</style>
