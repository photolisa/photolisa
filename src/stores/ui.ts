import { DEFAULT_SHAPES, loadShapeLibrary, saveShapePreset } from '../persistence/VectorShapeLibrary'
import type { VectorGeometry } from '../core/model/types'
import { defineStore } from 'pinia'
import type { EditorToolId } from '~/core/DocumentManager'
import { colorRgbHex, type SampledColor } from '~/raster/SampledColor'
import type { ColorSnapshot, ColorSwatch, SwatchCollection } from '~/core/colors/ColorManager'
import { parseHex } from '~/core/colors/ColorManager'
import { colorManager } from '../app/colorSession'

export type ToolId = EditorToolId

export const useUiStore = defineStore('ui', {
  state: () => ({
    customShapes: [...DEFAULT_SHAPES],
    customShapeIndex: 0,
    vectorPaintTarget: null as null | { documentId: string; layerId: string; target: 'fill' | 'stroke'; returnTool: ToolId },
    activeTool: 'move' as ToolId,
    moveAutoSelect: true,
    textResizeMode: 'box' as 'box' | 'scale',
    transformOrigin: { x: .5, y: .5 },
    moveSnapToCanvas: false,
    objectSnapping: { tolerance: 6, grid: 0, guidesX: [] as number[], guidesY: [] as number[] },
    zoom: 1,
    brush: { diameter: 32, hardness: 0.8, opacity: 1, flow: 1, spacing: 0.12, color: '#000000' },
    pencil: { diameter: 1, opacity: 1, pixelGrid: false },
    bucket: { tolerance: 10, opacity: 1 },
    shape: { creationMode: 'layer' as 'layer' | 'compound', fill: '#000000', fillOpacity: 1, stroke: null as string | null, strokeOpacity: 1, strokeWidth: 1, opacity: 1, cornerRadius: 16, sides: 5, innerRadius: .5 },
    foregroundColor: { r: 0, g: 0, b: 0, a: 255 } as SampledColor,
    secondaryColor: { r: 255, g: 255, b: 255, a: 255 } as SampledColor,
    recentSwatches: [] as SampledColor[],
    favoriteSwatches: [] as ColorSwatch[],
    colorCollections: [] as SwatchCollection[],
    colorError: null as string | null,
    colorPickerTarget: null as 'foreground' | 'background' | null,
    eyedropperSampleMode: 'visible' as 'visible' | 'active',
    leftPanelVisible: true,
    rightPanelVisible: true,
  }),
  actions: {
    addShapePreset(name: string, geometry: VectorGeometry) { this.customShapes = saveShapePreset(this.customShapes, name, geometry); this.customShapeIndex = this.customShapes.length - 1 },
    setTool(tool: ToolId) { this.activeTool = tool },
    setZoom(zoom: number) { this.zoom = Math.min(32, Math.max(0.01, zoom)) },
    openColorPicker(target: 'foreground' | 'background') { this.colorPickerTarget = target },
    closeColorPicker() { this.colorPickerTarget = null },
    connectColors(): () => void {
      this.customShapes = loadShapeLibrary()
      const unsubscribe = colorManager.subscribe((snapshot) => this.applyColorSnapshot(snapshot))
      void colorManager.load().catch((error: unknown) => { this.colorError = error instanceof Error ? error.message : 'Color swatches could not be loaded' })
      return unsubscribe
    },
    applyColorSnapshot(snapshot: ColorSnapshot) {
      this.foregroundColor = snapshot.foreground
      this.secondaryColor = snapshot.background
      this.recentSwatches = snapshot.history.slice(0, 12)
      this.favoriteSwatches = snapshot.favorites
      this.colorCollections = snapshot.collections
      this.brush.color = colorRgbHex(snapshot.foreground)
      this.shape.fill = colorRgbHex(snapshot.foreground)
      this.shape.fillOpacity = snapshot.foreground.a / 255
      this.colorError = colorManager.persistenceError
    },
    selectSampledColor(color: SampledColor) {
      colorManager.setForeground(color)
      this.applyColorSnapshot(colorManager.snapshot)
    },
    setForegroundRgb(hex: string) {
      if (!/^#[0-9a-f]{6}$/i.test(hex)) return
      colorManager.setForeground({ ...parseHex(hex), a: this.foregroundColor.a })
      this.applyColorSnapshot(colorManager.snapshot)
    },
    setSecondaryRgb(hex: string) {
      if (!/^#[0-9a-f]{6}$/i.test(hex)) return
      colorManager.setBackground({ ...parseHex(hex), a: this.secondaryColor.a })
      this.applyColorSnapshot(colorManager.snapshot)
    },
    swapColors() {
      colorManager.swap(); this.applyColorSnapshot(colorManager.snapshot)
    },
    resetColors() { colorManager.reset(); this.applyColorSnapshot(colorManager.snapshot) },
    setColor(target: 'foreground' | 'background', color: SampledColor) {
      if (target === 'foreground') colorManager.setForeground(color)
      else colorManager.setBackground(color)
      this.applyColorSnapshot(colorManager.snapshot)
    },
    addFavorite(name?: string) { const id = colorManager.addFavorite(this.foregroundColor, name); this.applyColorSnapshot(colorManager.snapshot); return id },
    removeFavorite(id: string) { colorManager.removeFavorite(id); this.applyColorSnapshot(colorManager.snapshot) },
    renameFavorite(id: string, name: string) { colorManager.renameFavorite(id, name); this.applyColorSnapshot(colorManager.snapshot) },
    createColorCollection(name: string) { const id = colorManager.createCollection(name); this.applyColorSnapshot(colorManager.snapshot); return id },
    renameColorCollection(id: string, name: string) { colorManager.renameCollection(id, name); this.applyColorSnapshot(colorManager.snapshot) },
    removeColorCollection(id: string) { colorManager.removeCollection(id); this.applyColorSnapshot(colorManager.snapshot) },
    addCollectionColor(id: string, name?: string) { const swatchId = colorManager.addColor(id, this.foregroundColor, name); this.applyColorSnapshot(colorManager.snapshot); return swatchId },
    renameCollectionColor(id: string, swatchId: string, name: string) { colorManager.renameColor(id, swatchId, name); this.applyColorSnapshot(colorManager.snapshot) },
    removeCollectionColor(id: string, swatchId: string) { colorManager.removeColor(id, swatchId); this.applyColorSnapshot(colorManager.snapshot) },
  },
})
