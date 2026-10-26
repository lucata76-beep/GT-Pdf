// Icone Lucide nel repository (licenza: LICENSES/Lucide-ISC-MIT.txt).
import chevronLeft from '../assets/icons/chevron-left.svg?raw';
import chevronRight from '../assets/icons/chevron-right.svg?raw';
import copy from '../assets/icons/copy.svg?raw';
import download from '../assets/icons/download.svg?raw';
import fileUp from '../assets/icons/file-up.svg?raw';
import folderOpen from '../assets/icons/folder-open.svg?raw';
import maximize from '../assets/icons/maximize.svg?raw';
import play from '../assets/icons/play.svg?raw';
import share from '../assets/icons/share-2.svg?raw';
import zoomIn from '../assets/icons/zoom-in.svg?raw';
import zoomOut from '../assets/icons/zoom-out.svg?raw';

const ICONS = {
  'chevron-left': chevronLeft,
  'chevron-right': chevronRight,
  copy,
  download,
  'file-up': fileUp,
  'folder-open': folderOpen,
  maximize,
  play,
  share,
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
