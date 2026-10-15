<script setup lang="ts">
import ObjectToolbar from './ObjectToolbar.vue'
import EditorEyedropperPreview from './EyedropperPreview.vue'
import { useCanvasWorkspace, type CanvasWorkspaceProps, type CanvasWorkspaceEvents } from '../../composables/useCanvasWorkspace'

const props = defineProps<CanvasWorkspaceProps>()
const emit = defineEmits<CanvasWorkspaceEvents>()
const { host, draggingFile, controls, vectorPaint, setObjectPaint, samplePreview, onDragEnter, onDragLeave, onDrop, onCanvasAction, actions } = useCanvasWorkspace(props, emit)

defineExpose(actions)

const fileFormats = [
  {name: "PNG", type: "ok"},
  {name: "JPG", type: "ok"},
  {name: "ICO", type: "ok"},
  {name: "WEBP", type: "ok"},
  {name: "SVG", type: "ok"},
  {name: "PSD", type: "ok"},
  {name: "PDF", type: "ok"},
  {name: "GIF", type: "soon"},
  {name: "AI", type: "soon"},
  {name: "EPS", type: "soon"},
  {name: "TIFF", type: "soon"},
];
</script>

<template>
  <main class="relative min-h-0 min-w-0 flex-1 overflow-hidden"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div ref="host" class="absolute inset-0" />
    <ObjectToolbar v-if="controls && document" :controls="controls" :vector-paint="vectorPaint" @action="onCanvasAction($event)" @paint="setObjectPaint" />
    <EditorEyedropperPreview v-if="samplePreview" :sample="samplePreview" />
    <div v-if="!document" class="absolute inset-0 grid place-items-center">
      <div class="text-center text-ui-secondary-text">
        <div class="mb-4">
          <img class="max-w-full max-h-50 inline-block" src="../../assets/img/monalisa.png" alt="Mona Lisa">
        </div>
        <p class="mb-2 text-2xl font-medium tracking-tight text-white">Your next great edit starts here.</p>
        <p class="mb-4 text-lg text-ui-secondary-text">Drop an image into your workspace, or start with a blank canvas.</p>
        <div class="mb-10  flex justify-center gap-2">
          <button class="rounded-full bg-accent px-5 py-3 text-base font-medium text-ui-text hover:bg-accent-hover" @click="emit('openFile')">Open image</button>
          <button class="rounded-full border border-ui-border bg-ui-elevated px-5 py-3 text-base text-ui-text hover:bg-ui-hover" aria-label="Start blank canvas" @click="emit('newDocument')">New document</button>
        </div>


        <div class="text-center mb-10">
          <ul>
            <li v-for="fileFormat in fileFormats" :key="fileFormat.name" class="px-2 mx-2 inline-block">
            <span class="transition-opacity group inline-block relative">
              <span v-if="fileFormat.type === 'soon' || fileFormat.type === 'soon-dev'" class="-top-3 hidden group-hover:inline-block text-nowrap rounded-md py-1 px-2 text-xs max-w-2xl absolute -translate-y-full -translate-x-1/2 bg-ui-900 text-white bg-ui-800!">
                {{("Coming soon")}}
                <span class="z-20 border-l-8 border-r-8 border-t-8 border-transparent border-t-gray-900 w-2 h-2 absolute -bottom-2 left-1/2 -translate-x-1/2"></span>
              </span>


              <span :class="{'opacity-30' : fileFormat.type === 'soon' || fileFormat.type === 'soon-dev'}" class="
              group-hover:opacity-100  relative
              rounded-tr-2xl overflow-hidden bg-white/5 w-12 h-14 rounded-lg border border-gray-800 block border-neutral-400">
                <span class="bg-neutral-700 border-b border-l border-neutral-400 w-4 h-4 block absolute top-0 right-0 rounded-bl-lg
                  "></span>
              </span>

              <span :class="(fileFormat.type === 'soon' || fileFormat.type === 'soon-dev') ? 'bg-neutral-800 text-neutral-400' : ' bg-neutral-700 text-white'" class="
               group-hover:bg-neutral-700 group-hover:text-white
                font-bold transition-transform bottom-3 -left-2
                group-hover:translate-x-1 absolute w-10 h-5  flex items-center justify-center rounded-md text-xs">{{fileFormat.name}}</span>
            </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
    <div v-if="draggingFile" class="pointer-events-none absolute inset-5 z-20 grid place-items-center border-2 border-dashed border-accent bg-accent/10">
      <span class="rounded bg-ui-toolbar px-4 py-2 text-sm text-ui-text">Drop image to open</span>
    </div>
    <div v-if="importing" class="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-black/30">
      <span class="rounded bg-ui-toolbar px-4 py-2 text-xs text-ui-text">Decoding image…</span>
    </div>
  </main>
</template>
