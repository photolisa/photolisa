import panelRight from '@iconify-icons/lucide/panel-right'
import undo from '@iconify-icons/lucide/undo-2'
import redo from '@iconify-icons/lucide/redo-2'
import download from '@iconify-icons/lucide/download'
import ellipsis from '@iconify-icons/lucide/ellipsis'
import image from '@iconify-icons/lucide/image'
import arrowDown from '@iconify-icons/lucide/arrow-down'
import arrowUp from '@iconify-icons/lucide/arrow-up'
import chevronDown from '@iconify-icons/lucide/chevron-down'
import copyPlus from '@iconify-icons/lucide/copy-plus'
import crop from '@iconify-icons/lucide/crop'
import eraser from '@iconify-icons/lucide/eraser'
import eye from '@iconify-icons/lucide/eye'
import eyeOff from '@iconify-icons/lucide/eye-off'
import folderMinus from '@iconify-icons/lucide/folder-minus'
import folderPlus from '@iconify-icons/lucide/folder-plus'
import hand from '@iconify-icons/lucide/hand'
import lock from '@iconify-icons/lucide/lock'
import lockOpen from '@iconify-icons/lucide/lock-open'
import minus from '@iconify-icons/lucide/minus'
import mousePointer from '@iconify-icons/lucide/mouse-pointer-2'
import paintbrush from '@iconify-icons/lucide/paintbrush'
import paintBucket from '@iconify-icons/lucide/paint-bucket'
import pencil from '@iconify-icons/lucide/pencil'
import pipette from '@iconify-icons/lucide/pipette'
import plus from '@iconify-icons/lucide/plus'
import rotateCcw from '@iconify-icons/lucide/rotate-ccw'
import scaling from '@iconify-icons/lucide/scaling'
import squareDashed from '@iconify-icons/lucide/square-dashed'
import trash from '@iconify-icons/lucide/trash-2'
import x from '@iconify-icons/lucide/x'
import zoomIn from '@iconify-icons/lucide/zoom-in'
import rectangleHorizontal from '@iconify-icons/lucide/rectangle-horizontal'
import squareRoundCorner from '@iconify-icons/lucide/square-round-corner'
import circle from '@iconify-icons/lucide/circle'
import ellipse from '@iconify-icons/lucide/ellipse'
import hexagon from '@iconify-icons/lucide/hexagon'
import minusIcon from '@iconify-icons/lucide/minus'
import pentagon from '@iconify-icons/lucide/pentagon'
import typeIcon from '@iconify-icons/lucide/type'
import github from '@iconify-icons/lucide/github'
import bug from '@iconify-icons/lucide/bug'
import home from '@iconify-icons/lucide/home'
import brush from '@iconify-icons/lucide/brush'

/** Explicit icon-data imports keep editor controls available offline and out of the Iconify API. */
export const editorIcons = {
  panelRight, undo, redo, download, ellipsis, image,
  github,
  home,
  bug,
  'arrow-down': arrowDown,
  'arrow-up': arrowUp,
  'chevron-down': chevronDown,
  'copy-plus': copyPlus,
  crop,
  eraser,
  eye,
  'eye-off': eyeOff,
  'folder-minus': folderMinus,
  'folder-plus': folderPlus,
  hand,
  lock,
  'lock-open': lockOpen,
  minus,
  'mouse-pointer': mousePointer,
  paintbrush,
  'paint-bucket': paintBucket,
  pencil,
  pipette,
  plus,
  'rotate-ccw': rotateCcw,
  scaling,
  'square-dashed': squareDashed,
  trash,
  x,
  'zoom-in': zoomIn,
  'rectangle-horizontal': rectangleHorizontal,
  'square-round-corner': squareRoundCorner,
  circle,
  ellipse,
  brush,
  hexagon,
  line: minusIcon,
  polygon: pentagon,
  type: typeIcon,
} as const

export type EditorIconName = keyof typeof editorIcons
