<script setup lang="ts">
import { ref } from 'vue'
import { useDialogFocus } from '../../composables/useDialogFocus'
import type { PdfPageInfo } from '../../adapters/pdf/PdfImportSession'
const props = defineProps<{
  name: string
  pages: PdfPageInfo[]
  busy: boolean
  progress: string
  passwordNeeded: boolean
  passwordIncorrect: boolean
  canImportLayers: boolean
}>()
const emit = defineEmits<{
  close: []
  unlock: [password: string]
  import: [selection: string, dpi: number, target: 'tabs' | 'layers']
}>()
const selection = ref('1'),
  dpi = ref(150),
  target = ref<'tabs' | 'layers'>('tabs'),
  password = ref('')
const root = ref<HTMLElement | null>(null)
useDialogFocus(root)
function unlock() {
  emit('unlock', password.value)
  password.value = ''
}
</script>
<template>
  <div class="fixed inset-0 z-50 grid place-items-center bg-black/65">
    <section
      ref="root"
      @keydown.stop
      @keydown.esc.prevent="emit('close')"
      class="border-ui-border bg-ui-panel max-h-[90vh] w-[min(48rem,95vw)] overflow-auto border p-5 text-xs shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdf-import-title"
    >
      <h2 id="pdf-import-title" class="mb-3 text-sm font-semibold">
        Import PDF
      </h2>
      <p>{{ name }} · {{ pages.length }} pages</p>
      <form
        v-if="passwordNeeded"
        class="my-4 space-y-3"
        @submit.prevent="unlock"
      >
        <p>
          {{
            passwordIncorrect
              ? 'Incorrect password. Try again.'
              : 'This PDF requires a password.'
          }}
        </p>
        <label class="block"
          >PDF password
          <input
            v-model="password"
            type="password"
            autocomplete="off"
            class="border-ui-border bg-ui-bg border p-2"
        /></label>
        <button type="submit" class="bg-accent px-3 py-2">Unlock PDF</button>
      </form>
      <template v-else>
        <div class="my-4 grid max-h-72 grid-cols-3 gap-3 overflow-auto">
          <button
            v-for="page in pages"
            :key="page.number"
            class="border-ui-border border p-2 text-center"
            :disabled="busy"
            @click="selection = String(page.number)"
          >
            <img
              v-if="page.preview"
              :src="page.preview"
              :alt="`PDF page ${page.number} preview`"
              class="mx-auto h-28 max-w-full bg-white object-contain"
            />
            <p>
              Page {{ page.number }} · {{ page.width.toFixed(1) }} ×
              {{ page.height.toFixed(1) }} pt
            </p>
            <p>Rotation {{ page.rotation }}°</p>
          </button>
        </div>
        <fieldset :disabled="busy" class="space-y-3">
          <label class="block"
            >Pages
            <input
              v-model="selection"
              aria-label="PDF pages"
              class="border-ui-border bg-ui-bg ml-2 border p-2"
              placeholder="1, 3-5"
          /></label>
          <button
            class="border-ui-border border px-3 py-1"
            @click="selection = `1-${props.pages.length}`"
          >
            Select all pages
          </button>
          <label class="block"
            >Resolution (DPI)
            <input
              v-model.number="dpi"
              aria-label="PDF import DPI"
              type="number"
              min="1"
              max="1200"
              list="pdf-import-dpi"
              class="border-ui-border bg-ui-bg ml-2 border p-2"
          /></label>
          <datalist id="pdf-import-dpi">
            <option value="72" />
            <option value="150" />
            <option value="300" />
          </datalist>
          <label class="block"
            >Import into
            <select
              v-model="target"
              aria-label="PDF import target"
              class="border-ui-border bg-ui-bg ml-2 border p-2"
            >
              <option value="tabs">Separate project tabs</option>
              <option value="layers" :disabled="!canImportLayers">
                Active project as raster layers
              </option>
            </select></label
          >
        </fieldset>
        <p class="text-ui-secondary-text my-3">
          Pages are rasterized. PDF text, paths, forms, and links will not
          become editable objects. Transparent areas are preserved where
          supported. Embedded images over 16 megapixels may be omitted by safety
          limits; check the previews.
        </p>
      </template>
      <p role="status" class="my-3">{{ progress }}</p>
      <footer
        class="border-ui-border bg-ui-panel sticky bottom-0 -mx-5 -mb-5 flex justify-end gap-3 border-t px-5 py-3"
      >
        <button
          class="border-ui-border border px-3 py-2"
          @click="emit('close')"
        >
          Cancel</button
        ><button
          class="bg-accent px-3 py-2 disabled:opacity-50"
          :disabled="busy || !pages.length || passwordNeeded"
          @click="emit('import', selection, dpi, target)"
        >
          Import pages
        </button>
      </footer>
    </section>
  </div>
</template>
