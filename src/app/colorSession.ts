import { ColorManager } from '../core/colors/ColorManager'
import { BrowserColorStorage } from '../persistence/ColorStorage'

/** Shared color-library session. IndexedDB is opened only after client mount. */
export const colorManager = new ColorManager(new BrowserColorStorage())
