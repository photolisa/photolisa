<script setup lang="ts">
import { useUiStore } from '../../stores/ui'
import { colorHex, colorRgba } from '~/raster/SampledColor'
import {Icon} from "@iconify/vue";
const ui = useUiStore()
</script>

<template>
  <div class="px-1 py-2" aria-label="Foreground and background colors">
    <div class="relative mx-auto h-10 w-11">
      <button class="checker rounded-full absolute bottom-0 right-1 size-7 border-2 border-white shadow-sm"
              :title="`Background ${colorHex(ui.secondaryColor)}`" aria-label="Background color picker"
              @click="ui.openColorPicker('background')"><span class="block rounded-full h-full w-full"
                                                              :style="{ backgroundColor: colorRgba(ui.secondaryColor) }"/>
      </button>
      <button class="checker rounded-full absolute left-0 top-0 size-7 border-2 border-white shadow-md"
              :title="`Foreground ${colorHex(ui.foregroundColor)}`" aria-label="Foreground color picker"
              @click="ui.openColorPicker('foreground')"><span class="block rounded-full h-full w-full"
                                                              :style="{ backgroundColor: colorRgba(ui.foregroundColor) }"/>
      </button>
    </div>
    <div class="mt-1 flex justify-center gap-1">
      <button class="text-lg hover:bg-gray-700/50 text-white/70 hover:text-white" title="Reset colors to black and white (D)"
              aria-label="Reset colors to black and white" @click="ui.resetColors()">
        <Icon icon="radix-icons:reset"/>
      </button>
      <button class="text-lg hover:bg-gray-700/50 text-white/70 hover:text-white" title="Swap foreground and background (X)"
              aria-label="Swap foreground and background colors" @click="ui.swapColors()">
        <Icon icon="lets-icons:horizontal-switch"/>
      </button>
    </div>
  </div>
</template>

<style scoped>
.checker {
  background-color: #fff;
  background-image: linear-gradient(45deg, #999 25%, transparent 25%), linear-gradient(-45deg, #999 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #999 75%), linear-gradient(-45deg, transparent 75%, #999 75%);
  background-size: 8px 8px;
  background-position: 0 0, 0 4px, 4px -4px, -4px 0;
}
</style>
