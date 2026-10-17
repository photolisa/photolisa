<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import EffectsPanel from '../components/effects/EffectsPanel.vue'
import { editorCore } from '../composables/useEditor'
const effectsCategory = ref<string | null>(null)
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f' && !(event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]'))) {
    event.preventDefault(); effectsCategory.value = 'All'
  }
})

import PdfImportDialog from '../components/editor/PdfImportDialog.vue'
import PdfExportDialog from '../components/editor/PdfExportDialog.vue'
import EditorAppMenuBar from '../components/editor/AppMenuBar.vue'
import EditorCanvasWorkspace from '../components/editor/CanvasWorkspace.vue'
import EditorCloseDocumentDialog from '../components/editor/CloseDocumentDialog.vue'
import EditorColorPicker from '../components/editor/ColorPicker.vue'
import EditorDocumentTabs from '../components/editor/DocumentTabs.vue'
import EditorIcoExportDialog from '../components/editor/IcoExportDialog.vue'
import EditorIcoImportDialog from '../components/editor/IcoImportDialog.vue'
import EditorIcon from '../components/editor/Icon.vue'
import EditorImageOperationDialog from '../components/editor/ImageOperationDialog.vue'
import EditorLossyExportDialog from '../components/editor/LossyExportDialog.vue'
import EditorNewDocumentDialog from '../components/editor/NewDocumentDialog.vue'
import EditorRightPanels from '../components/editor/RightPanels.vue'
import EditorStatusBar from '../components/editor/StatusBar.vue'
import EditorToolOptionsBar from '../components/editor/ToolOptionsBar.vue'
import EditorToolSidebar from '../components/editor/ToolSidebar.vue'
import { useEditorLayout } from '../composables/useEditorLayout'
import { useEditorWorkspace } from '../composables/useEditorWorkspace'

const layout = useEditorLayout()

const {
  pdf, ui, manager, currentDocument, canUndo, canRedo, isDirty,
  tabs, canReopen, importing, importError, clearImportError, showNewDialog,
  imageOperation, pendingRasterExport, fileInput, pendingIco, showIcoExport, icoBusy,
  recovery, compatibilityWarnings, tabBar, canvasWorkspace, tabControls, openNewDocument,
  create, selectTool, applyImageOperation, transformCanvas, featherSelection, editSelection,
  pasteSelection, pasteExternalImage, handleImport, openIcoResolution, exportIco, chooseFile,
  requestExportImage, exportImage, saveProject, exportPsd, exportSvg, recoverAutosave,
  onFileSelected, onViewChange, transferLayers, onTransferDrop, undo, redo,
} = useEditorWorkspace()
const effectLayer = computed(() => {
  void currentDocument.value?.revision
  const id = currentDocument.value?.activeLayerId
  const layer = id ? editorCore.layers.find(id) : null
  return layer && !layer.locked && (layer.kind === 'raster' || layer.kind === 'group' && !layer.booleanOperation) ? layer : null
})
</script>

<template>
  <div class="editor-shell flex h-screen w-screen flex-col bg-ui-bg text-ui-text">
    <EditorAppMenuBar
      :document-name="currentDocument?.name ?? null"
      :mode="layout.mode.value"
      :panels-visible="layout.panelsVisible.value"
      :can-undo="canUndo"
      :can-redo="canRedo"
      :can-export="Boolean(currentDocument)"
      :can-reopen="canReopen"
      :is-dirty="isDirty"
      @effects="effectsCategory = $event"
      @mode="layout.mode.value = $event"
      @toggle-panels="layout.togglePanels"
      @new-document="openNewDocument"
      @open-file="chooseFile"
      @save-project="saveProject"
      @rename-project="tabBar?.renameActive()"
      @close-project="() => { const id = manager.active?.id; if (id) tabControls.requestClose(id) }"
      @reopen-closed="tabControls.reopen"
      @export-image="requestExportImage"
      @export-psd="exportPsd"
      @export-svg="exportSvg"
      @export-pdf="pdf.requestExport"
      @export-ico="showIcoExport = true"
      @undo="undo"
      @redo="redo"
      @copy-selection="editSelection('copy')"
      @cut-selection="editSelection('cut')"
      @paste-selection="pasteSelection"
      @paste-external-image="pasteExternalImage"
      @fill-selection="editSelection('fill')"
      @delete-selection="editSelection('delete')"
      @image-resize="imageOperation = 'resize'"
      @canvas-size="imageOperation = 'canvas'"
      @canvas-transform="transformCanvas"
      @zoom-in="canvasWorkspace?.zoomIn()"
      @zoom-out="canvasWorkspace?.zoomOut()"
      @fit="canvasWorkspace?.fitToScreen()"
      @actual-size="canvasWorkspace?.actualSize()"
      @reset-view="canvasWorkspace?.resetView()"
    />
    <EditorDocumentTabs
      ref="tabBar"
      :tabs="tabs"
      :can-reopen="canReopen"
      @activate="tabControls.activate"
      @home="tabControls.home"
      @close="tabControls.requestClose"
      @rename="tabControls.rename"
      @reorder="(sourceId, targetId, after) => manager.reorder(sourceId, targetId, after)"
      @new-document="openNewDocument"
      @reopen="tabControls.reopen"
      @transfer-drop="onTransferDrop"
    />

    <div class="editor-workspace relative flex min-h-0 flex-1">
      <EditorToolSidebar :active-tool="ui.activeTool" @select="selectTool" />
      <div class="flex flex-col min-h-0 min-w-0 flex-1 overflow-hidden bg-ui-workspace rounded-xl border border-gray-600">
        <EditorToolOptionsBar :tool="ui.activeTool" @close-path="canvasWorkspace?.closePenPath()" @confirm="canvasWorkspace?.confirmTool()" @cancel="canvasWorkspace?.cancelTool()" @feather="featherSelection" />

        <EditorCanvasWorkspace
          ref="canvasWorkspace"
          :document="currentDocument"
          :revision="currentDocument?.revision ?? 0"
          :importing="importing"
          :tool="ui.activeTool"
          :view-state="tabControls.viewState.value"
          @view-change="onViewChange"
          @open-file="chooseFile"
          @new-document="openNewDocument"
          @import-file="handleImport"
          @error="(message) => importError = message"
        />
      </div>
      <EditorRightPanels v-show="layout.panelsVisible.value" :key="currentDocument?.id ?? 'empty'" :mode="layout.mode.value" :document="currentDocument" :revision="currentDocument?.revision ?? 0" :project-tabs="tabs" @collapse="layout.togglePanels" @transfer="transferLayers" />
    </div>
    <EditorStatusBar :document="currentDocument" :zoom="ui.zoom" @zoom="canvasWorkspace?.setZoom($event)" />
    <input ref="fileInput" class="hidden" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/vnd.adobe.photoshop,.png,.jpg,.jpeg,.webp,.svg,.ico,.psd,.photolisa,.pdf,application/pdf" @change="onFileSelected">
    <div v-if="recovery" class="fixed left-1/2 top-20 z-50 flex -translate-x-1/2 items-center gap-4 border border-accent/50 bg-ui-panel px-4 py-3 text-xs shadow-2xl">
      <span>Autosave available for {{ recovery.name }}</span><button class="text-accent hover:text-ui-text" @click="recoverAutosave">Recover</button><button class="text-ui-secondary-text hover:text-ui-text" @click="recovery = null">Dismiss</button>
    </div>
    <div v-if="compatibilityWarnings.length" class="fixed bottom-10 left-1/2 z-50 max-h-48 w-[min(42rem,90vw)] -translate-x-1/2 overflow-auto border border-warning bg-ui-panel px-4 py-3 text-xs text-warning shadow-2xl" role="status">
      <div class="mb-2 flex justify-between"><strong>Compatibility notes</strong><button class="grid h-5 w-5 place-items-center" aria-label="Dismiss compatibility notes" title="Dismiss compatibility notes" @click="compatibilityWarnings = []"><EditorIcon name="x" :size="14" /></button></div>
      <ul class="list-disc space-y-1 pl-4"><li v-for="warning in compatibilityWarnings" :key="warning">{{ warning }}</li></ul>
    </div>
    <div v-if="importError" class="fixed bottom-10 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-4 border border-danger bg-ui-panel px-4 py-3 text-xs text-danger shadow-2xl" role="alert">
      <span>{{ importError }}</span>
      <button class="grid h-5 w-5 place-items-center text-ui-secondary-text hover:text-ui-text" aria-label="Dismiss error" title="Dismiss error" @click="clearImportError"><EditorIcon name="x" :size="14" /></button>
    </div>
    <EffectsPanel v-if="effectsCategory !== null" :key="currentDocument?.id ?? 'empty-effects'" :layer="effectLayer" :category="effectsCategory" @close="effectsCategory = null" />
    <PdfImportDialog v-if="pdf.pending.value" :name="pdf.name.value" :pages="pdf.pages.value" :busy="pdf.busy.value" :progress="pdf.progress.value" :password-needed="pdf.passwordNeeded.value" :password-incorrect="pdf.passwordIncorrect.value" :can-import-layers="Boolean(currentDocument)" @close="pdf.closeImport" @unlock="pdf.unlock" @import="pdf.importPages" />
    <PdfExportDialog v-if="pdf.showExport.value" :tabs="tabs" :selected="pdf.exportSelection.value" :busy="pdf.busy.value" :progress="pdf.progress.value" :previews="pdf.previews.value" :warnings="pdf.exportWarnings.value" @close="pdf.cancelExport" @export="pdf.exportPdf" @invalidate="pdf.clearPreviews" @inspect="pdf.inspectExport" />
    <EditorNewDocumentDialog v-if="showNewDialog" @close="showNewDialog = false" @create="create" />
    <EditorImageOperationDialog v-if="imageOperation && currentDocument" :mode="imageOperation" :width="currentDocument.dimensions.width" :height="currentDocument.dimensions.height" @close="imageOperation = null" @apply="applyImageOperation" />
    <EditorLossyExportDialog v-if="pendingRasterExport && currentDocument" :format="pendingRasterExport" :name="currentDocument.name" @close="pendingRasterExport = null" @export="(quality, name) => exportImage(pendingRasterExport!, quality, name)" />
    <EditorIcoImportDialog v-if="pendingIco" :name="pendingIco.file.name" :entries="pendingIco.entries" :busy="icoBusy" @open="openIcoResolution" @close="pendingIco = null" />
    <EditorIcoExportDialog v-if="showIcoExport" :busy="icoBusy" @export="exportIco" @close="showIcoExport = false" />
    <EditorColorPicker v-if="ui.colorPickerTarget" :target="ui.colorPickerTarget" :color="ui.colorPickerTarget === 'foreground' ? ui.foregroundColor : ui.secondaryColor" @apply="ui.setColor(ui.colorPickerTarget!, $event); ui.closeColorPicker()" @close="ui.closeColorPicker()" />
    <EditorCloseDocumentDialog
      v-if="tabControls.pendingCloseId.value"
      :name="tabControls.pendingCloseName.value"
      @cancel="tabControls.pendingCloseId.value = null"
      @discard="tabControls.closeWithoutSaving"
      @save="tabControls.saveAndClose"
    />
  </div>
</template>
