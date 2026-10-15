<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import EditorIcon from './Icon.vue'
const props = defineProps<{
  mode: 'simple' | 'pro'
  panelsVisible: boolean
  documentName: string | null
  canUndo: boolean
  canRedo: boolean
  canExport: boolean
  canReopen: boolean
  isDirty: boolean
}>()

const emit = defineEmits<{
  mode: [mode: 'simple' | 'pro']
  togglePanels: []
  newDocument: []
  openFile: []
  saveProject: []
  renameProject: []
  closeProject: []
  reopenClosed: []
  exportImage: [format: 'png' | 'jpeg' | 'webp']
  exportPsd: []
  exportSvg: []
  exportIco: []
  exportPdf: []
  undo: []
  redo: []
  copySelection: []
  cutSelection: []
  pasteSelection: []
  pasteExternalImage: []
  fillSelection: []
  deleteSelection: []
  imageResize: []
  canvasSize: []
  canvasTransform: [operation: 'rotate-cw' | 'rotate-ccw' | 'flip-horizontal' | 'flip-vertical']
  zoomIn: []
  zoomOut: []
  fit: []
  actualSize: []
  resetView: []
}>()

type MenuId = 'file' | 'edit' | 'image' | 'layer' | 'view'
const openMenu = ref<MenuId | null>(null)
const root = ref<HTMLElement | null>(null)

const menus: { id: MenuId; label: string }[] = [
  { id: 'file', label: 'File' },
  { id: 'edit', label: 'Edit' },
  { id: 'image', label: 'Image' },
  { id: 'layer', label: 'Layer' },
  { id: 'view', label: 'View' },
]

function toggle(menu: MenuId): void {
  openMenu.value = openMenu.value === menu ? null : menu
}

function run(action: () => void): void {
  action()
  openMenu.value = null
}

function onOutside(event: PointerEvent): void {
  if (!root.value?.contains(event.target as Node)) openMenu.value = null
}

onMounted(() => window.addEventListener('pointerdown', onOutside))
onUnmounted(() => window.removeEventListener('pointerdown', onOutside))
</script>

<template>
  <header ref="root" class="app-header relative z-30 flex h-10 shrink-0 items-center border-b border-ui-border bg-ui-toolbar px-2 text-[13px] text-ui-text">
    <a class="editor-brand mr-3 flex shrink-0 items-center gap-2 rounded px-1 font-semibold tracking-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" href="https://photolisa.com" target="_blank" rel="noopener noreferrer" aria-label="Photolisa website" title="Photolisa website (opens in a new tab)">
      <img class="h-7" src="../../assets/img/logo-light.svg" alt="Photolisa" />
    </a>
    <nav aria-label="Application menu" class="flex h-full items-center gap-1">
      <div v-for="menu in menus" :key="menu.id" class="relative h-full">
        <button
          class="group menu-trigger text-sm h-full flex items-center"
          :class="{ 'active': openMenu === menu.id }"
          :aria-expanded="openMenu === menu.id"
          @click="toggle(menu.id)"
          @keydown.escape.stop="openMenu = null"
          @keydown.down.prevent="openMenu = menu.id"
        ><span :class="{ 'bg-ui-bg/40': openMenu === menu.id }"
               class="h-8 inline-flex items-center px-3 group-hover:bg-ui-bg/40 rounded-xl">{{ menu.label }}</span></button>

        <div v-if="openMenu === menu.id" class="menu-surface absolute left-0 top-11 min-w-52 border border-ui-border bg-ui-panel p-1 shadow-2xl" @keydown.escape.stop="openMenu = null">
          <template v-if="menu.id === 'file'">
            <button class="menu-item" @click="run(() => emit('newDocument'))">
              <span>New document…</span><kbd>Ctrl+N</kbd>
            </button>
            <button class="menu-item" @click="run(() => emit('openFile'))">
              <span>Open…</span><kbd>Ctrl+O</kbd>
            </button>
            <button class="menu-item" :disabled="!canExport" @click="run(() => emit('saveProject'))">
              <span>Save project{{ isDirty ? ' *' : '' }}…</span><kbd>Ctrl+S</kbd>
            </button>
            <button class="menu-item" :disabled="!canExport" @click="run(() => emit('renameProject'))"><span>Rename project…</span></button>
            <button class="menu-item" :disabled="!canExport" @click="run(() => emit('closeProject'))"><span>Close project</span><kbd>Ctrl+W</kbd></button>
            <button class="menu-item" :disabled="!canReopen" @click="run(() => emit('reopenClosed'))"><span>Reopen closed tab</span></button>
            <div class="my-1 border-t border-ui-border" />
            <button class="menu-item" :disabled="!canExport" @click="run(() => emit('exportImage', 'png'))">
              <span>Export PNG…</span><kbd>Ctrl+Alt+S</kbd>
            </button>
            <button class="menu-item" :disabled="!canExport" @click="run(() => emit('exportImage', 'jpeg'))"><span>Export JPEG…</span></button>
            <button class="menu-item" :disabled="!canExport" @click="run(() => emit('exportImage', 'webp'))"><span>Export WebP…</span></button>
            <button class="menu-item" :disabled="!canExport" @click="run(() => emit('exportPsd'))"><span>Export PSD…</span></button>
            <button class="menu-item" :disabled="!canExport" @click="run(() => emit('exportSvg'))"><span>Export SVG…</span></button>
            <button class="menu-item" :disabled="!canExport" @click="run(() => emit('exportPdf'))"><span>Export As PDF…</span></button>
            <button class="menu-item" :disabled="!canExport" @click="run(() => emit('exportIco'))"><span>Export ICO…</span></button>
          </template>
          <template v-else-if="menu.id === 'edit'">
            <button class="menu-item" :disabled="!canUndo" @click="run(() => emit('undo'))">
              <span>Undo</span><kbd>Ctrl+Z</kbd>
            </button>
            <button class="menu-item" :disabled="!canRedo" @click="run(() => emit('redo'))">
              <span>Redo</span><kbd>Ctrl+Shift+Z</kbd>
            </button>
            <div class="my-1 border-t border-ui-border" />
            <button class="menu-item" :disabled="!canExport" @click="run(() => emit('copySelection'))">Copy selection <kbd>Ctrl+C</kbd></button>
            <button class="menu-item" :disabled="!canExport" @click="run(() => emit('cutSelection'))">Cut selection <kbd>Ctrl+X</kbd></button>
            <button class="menu-item" :disabled="!canExport" @click="run(() => emit('pasteSelection'))">Paste pixels <kbd>Ctrl+V</kbd></button>
            <button class="menu-item" :disabled="!canExport" @click="run(() => emit('pasteExternalImage'))">Paste external image…</button>
            <button class="menu-item" :disabled="!canExport" @click="run(() => emit('fillSelection'))">Fill selection</button>
            <button class="menu-item" :disabled="!canExport" @click="run(() => emit('deleteSelection'))">Delete selected pixels <kbd>Delete</kbd></button>
          </template>
          <template v-else-if="menu.id === 'image'">
            <button class="menu-item" :disabled="!canExport" @click="run(() => emit('imageResize'))">Image size…</button>
            <button class="menu-item" :disabled="!canExport" @click="run(() => emit('canvasSize'))">Canvas size…</button>
            <div class="my-1 border-t border-ui-border" />
            <button class="menu-item" :disabled="!canExport" @click="run(() => emit('canvasTransform', 'rotate-cw'))">Rotate 90° clockwise</button>
            <button class="menu-item" :disabled="!canExport" @click="run(() => emit('canvasTransform', 'rotate-ccw'))">Rotate 90° counterclockwise</button>
            <button class="menu-item" :disabled="!canExport" @click="run(() => emit('canvasTransform', 'flip-horizontal'))">Flip canvas horizontally</button>
            <button class="menu-item" :disabled="!canExport" @click="run(() => emit('canvasTransform', 'flip-vertical'))">Flip canvas vertically</button>
          </template>
          <template v-else-if="menu.id === 'view'">
            <button class="menu-item" @click="run(() => emit('zoomIn'))">Zoom in</button>
            <button class="menu-item" @click="run(() => emit('zoomOut'))">Zoom out</button>
            <button class="menu-item" @click="run(() => emit('fit'))">Fit on screen</button>
            <button class="menu-item" @click="run(() => emit('actualSize'))">Actual size</button>
            <button class="menu-item" @click="run(() => emit('resetView'))">Reset view</button>
          </template>
          <p v-else class="px-3 py-2 text-xs text-ui-secondary-text">No actions available yet</p>
        </div>
      </div>
    </nav>
    <div class="document-title ml-auto max-w-[25%] truncate px-3 text-xs text-ui-secondary-text">{{ props.documentName ? `${props.documentName}${props.isDirty ? ' *' : ''}` : 'No document open' }}</div>
    <div class="header-actions flex shrink-0 items-center gap-1.5">
      <nav aria-label="Project links" class="flex items-center gap-1 border-r border-ui-border pr-2">
        <a class="project-link" href="https://github.com/photolisa/photolisa" target="_blank" rel="noopener noreferrer" aria-label="GitHub" title="GitHub (opens in a new tab)"><EditorIcon name="github" :size="16" /><span>GitHub</span></a>
        <a class="project-link" href="https://github.com/photolisa/photolisa/issues" target="_blank" rel="noopener noreferrer" aria-label="Submit issue" title="Submit issue (opens in a new tab)"><EditorIcon name="bug" :size="16" /><span>Submit issue</span></a>
      </nav>
      <div class="history-actions flex items-center gap-1 border-r border-ui-border pr-2">
        <button class="header-icon" title="Undo (Ctrl+Z)" aria-label="Step back" :disabled="!canUndo" @click="emit('undo')"><EditorIcon name="undo" :size="17" /></button>
        <button class="header-icon" title="Redo (Ctrl+Shift+Z)" aria-label="Step forward" :disabled="!canRedo" @click="emit('redo')"><EditorIcon name="redo" :size="17" /></button>
      </div>
      <div class="mode-switch flex rounded-lg bg-ui-elevated p-0.5" aria-label="Workspace mode">
        <button v-for="item in ['simple', 'pro'] as const" :key="item" class="rounded-md px-2.5 py-1 text-[11px] capitalize" :class="mode === item ? 'bg-ui-active text-ui-text' : 'text-ui-secondary-text hover:text-ui-text'" :aria-pressed="mode === item" :title="item === 'simple' ? 'Simple workspace: focus on one panel' : 'Pro workspace: properties and layers together'" @click="emit('mode', item)">{{ item === 'simple' ? 'Simple' : 'Pro' }}</button>
      </div>
      <button class="header-icon" :aria-pressed="panelsVisible" aria-label="Toggle right panels" title="Show or hide right panels" @click="emit('togglePanels')"><EditorIcon name="panelRight" :size="17" /></button>
      <button class="export-button flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover " :disabled="!canExport" title="Export PNG (Ctrl+Alt+S); more formats in File" aria-label="Quick export" @click="emit('exportImage', 'png')">
        <EditorIcon name="download" :size="15" />
        <span>Export</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
@reference "../../assets/css/main.css";
.menu-item {
  @apply flex w-full items-center justify-between gap-8 px-3 py-1.5 text-left text-ui-text hover:bg-ui-hover hover:text-ui-text disabled:cursor-default disabled:text-ui-muted disabled:hover:bg-transparent;
}

.app-header {
  background: #141414;
  //background: linear-gradient(110deg, #343b65 0%, #252d46 35%, #403b55 68%, #27456c 100%);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border-bottom-color: #ffffff20;
}

.menu-surface {
  border-radius: 10px;
  max-height: calc(100dvh - 64px);
  overflow: auto;
}

.header-icon {
  @apply grid h-8 w-8 place-items-center rounded-lg text-ui-secondary-text hover:bg-ui-hover hover:text-ui-text disabled:opacity-30;
}

.project-link {
  @apply flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-ui-secondary-text hover:bg-ui-bg/40 hover:text-ui-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent;
}

.menu-item {
  border-radius: 5px;
}

@media (max-width: 1100px) {
  .document-title {
    display: none;
  }

  .header-actions {
    margin-left: auto;
  }
}

@media (max-width: 900px) {
  .project-link {
    width: 28px;
    padding: 0;
    justify-content: center;
  }

  .project-link span {
    display: none;
  }
}

@media (max-width: 700px) {
  .editor-brand {
    display: none;
  }

  .menu-trigger {
    padding: 0 8px;
  }

  .history-actions {
    display: none;
  }

  .export-button span {
    display: none;
  }

  .mode-switch button {
    padding: 4px 6px;
  }
}

@media (max-width: 420px) {
  .mode-switch {
    display: none;
  }

  .menu-trigger {
    padding: 0 6px;
  }

  .header-actions {
    gap: 2px;
  }
}

kbd {
  @apply text-[10px] text-ui-secondary-text;
}
</style>
