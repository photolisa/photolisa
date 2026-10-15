<script setup lang="ts">
import { ref, watch } from 'vue'
import { useDialogFocus } from '../../composables/useDialogFocus'
import type { DocumentTab } from '../../core/DocumentManager'
import {
  defaultPdfOptions,
  type PdfExportOptions,
} from '../../adapters/pdf/PdfOptions'
const props = defineProps<{
  tabs: readonly DocumentTab[]
  selected: string[]
  busy: boolean
  progress: string
  previews: string[]
  warnings: string[]
}>()
const emit = defineEmits<{
  close: []
  export: [ids: string[], options: PdfExportOptions, preview: boolean]
  invalidate: []
  inspect: [ids: string[], mode: string]
}>()
const ids = ref([...props.selected]),
  options = ref(defaultPdfOptions()),
  root = ref<HTMLElement | null>(null)
useDialogFocus(root)
watch(
  [ids, options],
  () => {
    emit('invalidate')
    emit('inspect', ids.value, options.value.mode)
  },
  { deep: true, immediate: true },
)
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
      aria-labelledby="pdf-export-title"
    >
      <h2 id="pdf-export-title" class="mb-4 text-sm font-semibold">
        Export PDF
      </h2>
      <fieldset :disabled="busy" class="space-y-4">
        <div class="max-h-36 overflow-auto">
          <p class="mb-2">Projects (in tab order)</p>
          <label v-for="tab in tabs" :key="tab.id" class="block"
            ><input v-model="ids" type="checkbox" :value="tab.id" />
            {{ tab.name }}</label
          >
        </div>
        <label class="block"
          >Mode
          <select
            v-model="options.mode"
            aria-label="PDF export mode"
            class="border-ui-border bg-ui-bg ml-2 border p-2"
          >
            <option value="flattened">Flattened PDF</option>
            <option value="vector">Vector shapes (supported subset)</option>
          </select></label
        >
        <div class="grid grid-cols-2 gap-3">
          <label
            >Page size
            <select
              v-model="options.pageSize"
              aria-label="PDF page size"
              class="border-ui-border bg-ui-bg block w-full border p-2"
            >
              <option value="original">Original document size</option>
              <option value="a4">A4</option>
              <option value="a3">A3</option>
              <option value="letter">Letter</option>
              <option value="custom">Custom</option>
            </select></label
          >
          <label
            >Orientation
            <select
              v-model="options.orientation"
              aria-label="PDF orientation"
              :disabled="options.pageSize === 'original'"
              class="border-ui-border bg-ui-bg block w-full border p-2"
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select></label
          >
          <template v-if="options.pageSize === 'custom'"
            ><label
              >Width (mm)<input
                v-model.number="options.customWidth"
                aria-label="PDF width"
                type="number"
                class="border-ui-border bg-ui-bg block w-full border p-2" /></label
            ><label
              >Height (mm)<input
                v-model.number="options.customHeight"
                aria-label="PDF height"
                type="number"
                class="border-ui-border bg-ui-bg block w-full border p-2" /></label
          ></template>
          <label
            >Resolution (DPI)<input
              v-model.number="options.dpi"
              aria-label="PDF export DPI"
              type="number"
              min="1"
              max="1200"
              list="pdf-export-dpi"
              class="border-ui-border bg-ui-bg block w-full border p-2"
          /></label>
          <datalist id="pdf-export-dpi">
            <option value="72" />
            <option value="150" />
            <option value="300" />
          </datalist>
          <label
            >Margins (mm)<input
              v-model.number="options.margin"
              aria-label="PDF margins"
              type="number"
              min="0"
              class="border-ui-border bg-ui-bg block w-full border p-2"
          /></label>
          <label
            >Fit
            <select
              v-model="options.fit"
              aria-label="PDF fit"
              class="border-ui-border bg-ui-bg block w-full border p-2"
            >
              <option value="contain">Fit entire document</option>
              <option value="cover">Fill page (crop)</option>
              <option value="actual">
                Actual physical size (crop if needed)
              </option>
            </select></label
          >
          <label
            >Background
            <select
              v-model="options.background"
              aria-label="PDF background"
              class="border-ui-border bg-ui-bg block w-full border p-2"
            >
              <option value="white">White</option>
              <option value="custom">Custom color</option>
              <option value="transparent">Transparent (PNG)</option>
            </select></label
          >
          <label v-if="options.background === 'custom'"
            >Color<input
              v-model="options.color"
              aria-label="PDF background color"
              type="color"
              class="block"
          /></label>
          <label
            >Image embedding
            <select
              v-model="options.encoding"
              aria-label="PDF image encoding"
              class="border-ui-border bg-ui-bg block w-full border p-2"
            >
              <option value="png">PNG / lossless</option>
              <option value="jpeg">JPEG</option>
            </select></label
          >
          <label v-if="options.encoding === 'jpeg'"
            >JPEG quality<input
              v-model.number="options.quality"
              aria-label="PDF JPEG quality"
              type="number"
              min="0"
              max="1"
              step="0.05"
              class="border-ui-border bg-ui-bg block w-full border p-2"
          /></label>
        </div>
      </fieldset>
      <p
        v-if="options.mode === 'flattened'"
        class="text-ui-secondary-text my-3"
      >
        Flattened PDF: visible layers are composited as images. Text and shapes
        are not exported as editable objects. Original size uses document DPI.
        JPEG uses an opaque background.
      </p>
      <p v-if="options.mode === 'vector'" class="text-ui-secondary-text my-3">
        Solid opaque rectangles, circles, ellipses and lines can remain vector
        drawing operations. Text, groups, raster layers and unsupported effects
        flatten the entire page to preserve appearance. Embedded text fonts and
        editable PDF import are not supported.
      </p>
      <ul v-if="warnings.length" class="text-warning my-3 list-disc pl-4">
        <li v-for="warning in warnings" :key="warning">{{ warning }}</li>
      </ul>
      <div v-if="previews.length" class="flex max-h-60 gap-3 overflow-auto">
        <img
          v-for="(url, index) in previews"
          :key="url"
          :src="url"
          :alt="`PDF export page ${index + 1} preview`"
          class="border-ui-border max-h-56 border bg-white object-contain"
        />
      </div>
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
          class="border-ui-border border px-3 py-2"
          :disabled="busy || !ids.length"
          @click="emit('export', ids, options, true)"
        >
          Preview pages</button
        ><button
          class="bg-accent px-3 py-2 disabled:opacity-50"
          :disabled="busy || !ids.length"
          @click="emit('export', ids, options, false)"
        >
          Export PDF
        </button>
      </footer>
    </section>
  </div>
</template>
