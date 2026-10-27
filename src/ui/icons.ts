// Icone Lucide nel repository (licenza: LICENSES/Lucide-ISC-MIT.txt).
import chevronLeft from '../assets/icons/chevron-left.svg?raw';
import chevronRight from '../assets/icons/chevron-right.svg?raw';
import copy from '../assets/icons/copy.svg?raw';
import crosshair from '../assets/icons/crosshair.svg?raw';
import download from '../assets/icons/download.svg?raw';
import fileUp from '../assets/icons/file-up.svg?raw';
import folderOpen from '../assets/icons/folder-open.svg?raw';
import hand from '../assets/icons/hand.svg?raw';
import maximize from '../assets/icons/maximize.svg?raw';
import menu from '../assets/icons/menu.svg?raw';
import minus from '../assets/icons/minus.svg?raw';
import panelRight from '../assets/icons/panel-right.svg?raw';
import play from '../assets/icons/play.svg?raw';
import plus from '../assets/icons/plus.svg?raw';
import redo from '../assets/icons/redo-2.svg?raw';
import ruler from '../assets/icons/ruler.svg?raw';
import share from '../assets/icons/share-2.svg?raw';
import slash from '../assets/icons/slash.svg?raw';
import square from '../assets/icons/square.svg?raw';
import trash from '../assets/icons/trash-2.svg?raw';
import typeIcon from '../assets/icons/type.svg?raw';
import undo from '../assets/icons/undo-2.svg?raw';
import close from '../assets/icons/x.svg?raw';
import zoomIn from '../assets/icons/zoom-in.svg?raw';
import zoomOut from '../assets/icons/zoom-out.svg?raw';

const ICONS = {
  'chevron-left': chevronLeft,
  'chevron-right': chevronRight,
  copy,
  crosshair,
  download,
  'file-up': fileUp,
  'folder-open': folderOpen,
  hand,
  maximize,
  menu,
  minus,
  'panel-right': panelRight,
  play,
  plus,
  redo,
  ruler,
  share,
  slash,
  square,
  trash,
  type: typeIcon,
  undo,
  close,
  'zoom-in': zoomIn,
  'zoom-out': zoomOut,
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = ICONS[name];
  return span;
}
