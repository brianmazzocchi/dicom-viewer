import { catalogFromEntries, type CatalogInput } from './catalog';
import {
  currentWindow,
  hideStack,
  imageIdForFile,
  initEngine,
  onStackIndex,
  onWindowLevel,
  resetView,
  resize,
  setIndex,
  setMouseTool,
  setWindow,
  showStack,
  toggleInvert,
  type MouseTool,
} from './engine';
import { JpegStack } from './jpeg-stack';
import {
  WINDOW_PRESETS,
  findSeries,
  formatThickness,
  type FrameRef,
  type SeriesEntry,
  type StudyEntry,
} from './model';

type Origin = 'library' | 'files';
type ImageMode = 'dicom' | 'jpeg';

type ViewerState = {
  studies: StudyEntry[];
  origin: Origin;
  files: Map<string, File>;
  libraryName: string;
  seriesId: string;
  mode: ImageMode;
  tool: MouseTool;
  index: number;
  inverted: boolean;
  playing: boolean;
  token: number;
};

const droppedPaths = new WeakMap<File, string>();
const state: ViewerState = {
  studies: [],
  origin: 'library',
  files: new Map(),
  libraryName: '',
  seriesId: '',
  mode: 'dicom',
  tool: 'window',
  index: 0,
  inverted: false,
  playing: false,
  token: 0,
};

let cineTimer = 0;
let advancing = false;
let jpeg: JpegStack;

const studyList = required<HTMLDivElement>('study-list');
const overlay = required<HTMLDivElement>('overlay');
const overlayTitle = required<HTMLParagraphElement>('overlay-title');
const overlayDetail = required<HTMLParagraphElement>('overlay-detail');
const overlayOpen = required<HTMLButtonElement>('overlay-open');
const folderInput = required<HTMLInputElement>('folder-input');
const libraryButton = required<HTMLButtonElement>('open-library');
const sliceInput = required<HTMLInputElement>('slice');
const sliceLabel = required<HTMLSpanElement>('slice-label');
const fpsInput = required<HTMLInputElement>('fps');
const cineButton = required<HTMLButtonElement>('cine');
const invertButton = required<HTMLButtonElement>('invert');
const seriesWindowButton = required<HTMLButtonElement>('series-window');
const dicomButton = required<HTMLButtonElement>('mode-dicom');
const jpegButton = required<HTMLButtonElement>('mode-jpeg');
const hud = required<HTMLDivElement>('hud');
const hudStudy = required<HTMLDivElement>('hud-study');
const hudSeries = required<HTMLDivElement>('hud-series');
const hudWindow = required<HTMLDivElement>('hud-window');
const hudSlice = required<HTMLDivElement>('hud-slice');
const stage = required<HTMLDivElement>('stage');
const dicomViewport = required<HTMLDivElement>('dicom-viewport');
const presetGroup = required<HTMLDivElement>('presets');

export async function start(): Promise<void> {
  jpeg = new JpegStack(required<HTMLCanvasElement>('jpeg-viewport'));
  bindChrome();
  renderPresets();
  try {
    await initEngine(dicomViewport);
  } catch (error) {
    setOverlay({
      title: 'Viewer failed to start',
      detail: error instanceof Error ? error.message : 'Unknown error',
      showOpen: true,
    });
    return;
  }
  onStackIndex((index) => {
    if (state.mode !== 'dicom') return;
    state.index = index;
    updateSliceChrome();
    updateHud();
  });
  onWindowLevel((center, width) => {
    if (state.mode !== 'dicom') return;
    hudWindow.textContent = windowLabel(center, width);
  });
  new ResizeObserver(() => {
    resize();
    jpeg.resize();
  }).observe(stage);
  const library = await fetch('/api/library')
    .then((response) => response.json() as Promise<{ available?: boolean; name?: string }>)
    .catch((): { available?: boolean; name?: string } => ({ available: false }));
  if (library.available) {
    state.libraryName = library.name || 'Library';
    libraryButton.hidden = false;
    await loadLibrary();
  }
}

function bindChrome(): void {
  required<HTMLButtonElement>('open-folder').addEventListener('click', () => folderInput.click());
  overlayOpen.addEventListener('click', () => folderInput.click());
  libraryButton.addEventListener('click', () => void loadLibrary());
  folderInput.addEventListener('change', () => {
    const files = [...(folderInput.files ?? [])];
    folderInput.value = '';
    if (files.length > 0) void openFileList(files, rootName(files.map(filePath)));
  });

  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
    button.addEventListener('click', () => {
      state.tool = button.dataset.tool as MouseTool;
      setMouseTool(state.tool);
      syncToolButtons();
    });
  });

  seriesWindowButton.addEventListener('click', () => {
    const series = activeSeries();
    if (!series || series.windowCenter == null || series.windowWidth == null) return;
    setWindow(series.windowCenter, series.windowWidth);
  });
  invertButton.addEventListener('click', () => {
    state.inverted = state.mode === 'dicom' ? toggleInvert() : jpeg.toggleInvert();
    invertButton.setAttribute('aria-pressed', String(state.inverted));
  });
  required<HTMLButtonElement>('reset').addEventListener('click', () => {
    if (state.mode === 'dicom') resetView();
    else jpeg.reset();
    state.inverted = false;
    invertButton.setAttribute('aria-pressed', 'false');
    updateHud();
  });
  dicomButton.addEventListener('click', () => void setMode('dicom'));
  jpegButton.addEventListener('click', () => void setMode('jpeg'));
  cineButton.addEventListener('click', () => {
    if (state.playing) stopPlayback();
    else startPlayback();
  });
  sliceInput.addEventListener('input', () => {
    stopPlayback();
    void goTo(Number(sliceInput.value));
  });
  fpsInput.addEventListener('input', () => {
    if (state.playing) startPlayback();
  });

  studyList.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.series');
    if (!button?.dataset.series) return;
    void selectSeries(button.dataset.series);
  });

  const canvas = required<HTMLCanvasElement>('jpeg-viewport');
  let drag: { x: number; y: number; button: number } | undefined;
  canvas.addEventListener('pointerdown', (event) => {
    if (state.mode !== 'jpeg') return;
    stopPlayback();
    drag = { x: event.clientX, y: event.clientY, button: event.button };
    canvas.setPointerCapture(event.pointerId);
    stage.focus();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag = { x: event.clientX, y: event.clientY, button: drag.button };
    const tool: MouseTool = drag.button === 2 ? 'zoom' : drag.button === 1 ? 'pan' : state.tool;
    jpeg.drag(tool, dx, dy);
  });
  canvas.addEventListener('pointerup', () => {
    drag = undefined;
  });
  canvas.addEventListener('pointercancel', () => {
    drag = undefined;
  });
  canvas.addEventListener('wheel', (event) => {
    if (state.mode !== 'jpeg') return;
    event.preventDefault();
    stopPlayback();
    void goTo(state.index + Math.sign(event.deltaY));
  }, { passive: false });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  dicomViewport.addEventListener('wheel', () => stopPlayback(), { capture: true });
  stage.addEventListener('pointerdown', () => stage.focus());

  window.addEventListener('keydown', onKeyDown);
  bindDrop();
}

function renderPresets(): void {
  for (const preset of WINDOW_PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'text-button';
    button.textContent = preset.label;
    button.title = `Window ${preset.center} / ${preset.width}`;
    button.addEventListener('click', () => {
      if (state.mode !== 'dicom') return;
      setWindow(preset.center, preset.width);
    });
    presetGroup.append(button);
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLButtonElement) {
    return;
  }
  const frames = activeFrames();
  if (!frames?.length) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    event.preventDefault();
    stopPlayback();
    void goTo(state.index + 1);
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    event.preventDefault();
    stopPlayback();
    void goTo(state.index - 1);
  } else if (event.key === 'Home') {
    event.preventDefault();
    stopPlayback();
    void goTo(0);
  } else if (event.key === 'End') {
    event.preventDefault();
    stopPlayback();
    void goTo(frames.length - 1);
  } else if (event.key === ' ') {
    event.preventDefault();
    if (state.playing) stopPlayback();
    else startPlayback();
  } else if (event.key === 'i' || event.key === 'I') {
    invertButton.click();
  } else if (event.key === 'r' || event.key === 'R') {
    required<HTMLButtonElement>('reset').click();
  } else if (event.key === '[') {
    stepSeries(-1);
  } else if (event.key === ']') {
    stepSeries(1);
  } else {
    const presetIndex = Number(event.key) - 1;
    const preset = WINDOW_PRESETS[presetIndex];
    if (preset && state.mode === 'dicom') setWindow(preset.center, preset.width);
  }
}

function stepSeries(direction: number): void {
  const series = state.studies.flatMap((study) => study.series);
  const current = series.findIndex((entry) => entry.id === state.seriesId);
  const next = series[current + direction];
  if (next) void selectSeries(next.id);
}

async function loadLibrary(): Promise<void> {
  setOverlay({ title: 'Reading studies…', detail: state.libraryName, showOpen: false });
  const response = await fetch('/api/files');
  if (!response.ok) {
    setOverlay({ title: 'Could not read the library', detail: await response.text(), showOpen: true });
    return;
  }
  const body = (await response.json()) as { files: { rel: string }[] };
  state.origin = 'library';
  state.files = new Map();
  const studies = await catalogFromEntries(
    body.files.map((file) => ({
      relativePath: file.rel,
      read: (start, end) => readLibrary(file.rel, start, end),
    })),
    (done, total) => setOverlay({ title: 'Reading studies…', detail: `${done} / ${total}`, showOpen: false }),
  );
  await useStudies(studies, state.libraryName);
}

async function openFileList(files: File[], name: string): Promise<void> {
  const map = new Map<string, File>();
  const entries: CatalogInput[] = files.map((file) => {
    const relativePath = filePath(file);
    map.set(relativePath, file);
    return {
      relativePath,
      read: async (start, end) => {
        const blob = end == null ? file.slice(start) : file.slice(start, end + 1);
        return new Uint8Array(await blob.arrayBuffer());
      },
    };
  });
  state.origin = 'files';
  state.files = map;
  setOverlay({ title: 'Reading studies…', detail: name, showOpen: false });
  const studies = await catalogFromEntries(entries, (done, total) => {
    setOverlay({ title: 'Reading studies…', detail: `${done} / ${total}`, showOpen: false });
  });
  await useStudies(studies, name);
}

async function useStudies(studies: StudyEntry[], name: string): Promise<void> {
  state.studies = studies;
  document.title = studies[0]?.description || 'DICOM Viewer';
  renderStudies(name);
  const series = studies.flatMap((study) => study.series);
  const first = series.reduce<SeriesEntry | undefined>((largest, entry) => {
    const count = Math.max(entry.frames.length, entry.jpegs.length);
    const largestCount = largest ? Math.max(largest.frames.length, largest.jpegs.length) : -1;
    return count > largestCount ? entry : largest;
  }, undefined);
  if (!first) {
    setOverlay({ title: 'No DICOM or JPEG images in this folder', detail: name, showOpen: true });
    hud.hidden = true;
    return;
  }
  await selectSeries(first.id, first.frames.length ? 'dicom' : 'jpeg');
}

async function selectSeries(seriesId: string, mode?: ImageMode, index?: number): Promise<void> {
  const found = findSeries(state.studies, seriesId);
  if (!found) return;
  let nextMode = mode ?? state.mode;
  if (framesFor(found.series, nextMode).length === 0) {
    nextMode = nextMode === 'dicom' ? 'jpeg' : 'dicom';
  }
  const frames = framesFor(found.series, nextMode);
  if (frames.length === 0) {
    setOverlay({ title: 'This series has no images', detail: found.series.description, showOpen: false });
    return;
  }

  const token = ++state.token;
  stopPlayback();
  state.seriesId = seriesId;
  state.mode = nextMode;
  state.index = clamp(index ?? Math.floor((frames.length - 1) / 2), 0, frames.length - 1);
  state.inverted = false;
  invertButton.setAttribute('aria-pressed', 'false');
  syncSelection();
  syncModeButtons(found.series);
  syncPresetState();
  updateSliceChrome();
  setOverlay({
    title: nextMode === 'dicom' ? 'Decoding slice…' : 'Opening images…',
    detail: found.series.description,
    showOpen: false,
  });

  try {
    if (nextMode === 'dicom') {
      jpeg.hide();
      await showStack(frames.map((frame) => dicomImageId(frame.id)), state.index);
    } else {
      hideStack();
      await jpeg.open(frames.map((frame) => () => jpegBitmap(frame.id)), state.index);
    }
    if (token !== state.token) return;
    hideOverlay();
    updateHud();
    stage.focus();
  } catch (error) {
    if (token !== state.token) return;
    setOverlay({
      title: 'Could not open this series',
      detail: error instanceof Error ? error.message : 'Unknown error',
      showOpen: true,
    });
  }
}

async function setMode(mode: ImageMode): Promise<void> {
  if (!state.seriesId || mode === state.mode) return;
  await selectSeries(state.seriesId, mode, state.index);
}

async function goTo(index: number): Promise<void> {
  const frames = activeFrames();
  if (!frames?.length) return;
  state.index = clamp(index, 0, frames.length - 1);
  updateSliceChrome();
  updateHud();
  if (state.mode === 'dicom') await setIndex(state.index);
  else await jpeg.go(state.index);
}

function startPlayback(): void {
  stopPlayback();
  const frames = activeFrames();
  if (!frames || frames.length < 2) return;
  state.playing = true;
  cineButton.setAttribute('aria-pressed', 'true');
  cineButton.textContent = 'Pause';
  const fps = Math.max(1, fpsInput.valueAsNumber || 12);
  cineTimer = window.setInterval(() => {
    if (advancing) return;
    advancing = true;
    const count = activeFrames()?.length ?? 0;
    const next = count === 0 ? 0 : (state.index + 1) % count;
    void goTo(next).finally(() => {
      advancing = false;
    });
  }, 1000 / fps);
}

function stopPlayback(): void {
  window.clearInterval(cineTimer);
  cineTimer = 0;
  advancing = false;
  if (!state.playing) return;
  state.playing = false;
  cineButton.setAttribute('aria-pressed', 'false');
  cineButton.textContent = 'Play';
}

function renderStudies(name: string): void {
  studyList.replaceChildren();
  if (state.studies.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-copy';
    empty.textContent = 'No studies yet.';
    studyList.append(empty);
    return;
  }
  for (const study of state.studies) {
    const section = document.createElement('section');
    section.className = 'study';
    const header = document.createElement('header');
    const title = document.createElement('h2');
    title.textContent = study.description;
    const meta = document.createElement('p');
    meta.textContent = [study.patientName, study.studyDate, name].filter(Boolean).join(' · ');
    header.append(title, meta);
    section.append(header);
    for (const series of study.series) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'series';
      button.dataset.series = series.id;
      const label = document.createElement('span');
      label.className = 'series-title';
      label.textContent = series.description;
      const details = document.createElement('span');
      details.className = 'series-meta';
      const count = Math.max(series.frames.length, series.jpegs.length);
      const thickness = formatThickness(series.sliceThickness);
      details.textContent = [series.modality, `${count} images`, thickness].filter(Boolean).join(' · ');
      button.append(label, details);
      section.append(button);
    }
    studyList.append(section);
  }
  syncSelection();
}

function syncSelection(): void {
  studyList.querySelectorAll<HTMLButtonElement>('.series').forEach((button) => {
    const active = button.dataset.series === state.seriesId;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function syncModeButtons(series: SeriesEntry): void {
  dicomButton.disabled = series.frames.length === 0;
  jpegButton.disabled = series.jpegs.length === 0;
  dicomButton.setAttribute('aria-pressed', String(state.mode === 'dicom'));
  jpegButton.setAttribute('aria-pressed', String(state.mode === 'jpeg'));
}

function syncToolButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.tool === state.tool));
  });
}

function syncPresetState(): void {
  const dicom = state.mode === 'dicom';
  presetGroup.querySelectorAll('button').forEach((button) => {
    button.disabled = !dicom;
  });
  const series = activeSeries();
  seriesWindowButton.disabled = !dicom || series?.windowCenter == null || series.windowWidth == null;
}

function updateSliceChrome(): void {
  const count = activeFrames()?.length ?? 0;
  sliceInput.disabled = count < 2;
  sliceInput.min = '0';
  sliceInput.max = String(Math.max(0, count - 1));
  sliceInput.value = String(state.index);
  sliceLabel.textContent = count === 0 ? '0 / 0' : `${state.index + 1} / ${count}`;
}

function updateHud(): void {
  const found = state.seriesId ? findSeries(state.studies, state.seriesId) : undefined;
  if (!found) {
    hud.hidden = true;
    return;
  }
  hud.hidden = false;
  hudStudy.textContent = [found.study.patientName, found.study.studyDate].filter(Boolean).join(' · ');
  const size = found.series.columns && found.series.rows ? `${found.series.columns} × ${found.series.rows}` : '';
  hudSeries.textContent = [found.series.description, found.series.modality, size].filter(Boolean).join(' · ');
  const frame = activeFrames()?.[state.index];
  const location = frame?.sliceLocation != null ? ` · ${frame.sliceLocation.toFixed(1)} mm` : '';
  hudSlice.textContent = `${sliceLabel.textContent}${location}`;
  if (state.mode === 'dicom') {
    const voi = currentWindow();
    hudWindow.textContent = voi ? windowLabel(voi.center, voi.width) : 'DICOM';
  } else {
    hudWindow.textContent = 'JPEG preview';
  }
}

function setOverlay(options: { title: string; detail: string; showOpen: boolean }): void {
  overlay.hidden = false;
  overlayTitle.textContent = options.title;
  overlayDetail.textContent = options.detail;
  overlayOpen.hidden = !options.showOpen;
}

function hideOverlay(): void {
  overlay.hidden = true;
}

function activeSeries(): SeriesEntry | undefined {
  return state.seriesId ? findSeries(state.studies, state.seriesId)?.series : undefined;
}

function activeFrames(): FrameRef[] | undefined {
  const series = activeSeries();
  return series ? framesFor(series, state.mode) : undefined;
}

function framesFor(series: SeriesEntry, mode: ImageMode): FrameRef[] {
  return mode === 'jpeg' ? series.jpegs : series.frames;
}

function dicomImageId(id: string): string {
  if (state.origin === 'files') {
    const file = state.files.get(id);
    if (!file) throw new Error(`Missing ${id}`);
    return imageIdForFile(file);
  }
  return `wadouri:${fileUrl(id)}`;
}

async function jpegBitmap(id: string): Promise<ImageBitmap> {
  if (state.origin === 'files') {
    const file = state.files.get(id);
    if (!file) throw new Error(`Missing ${id}`);
    return createImageBitmap(file);
  }
  const response = await fetch(fileUrl(id));
  if (!response.ok) throw new Error(`Could not load ${id}`);
  return createImageBitmap(await response.blob());
}

function fileUrl(relativePath: string): string {
  const url = new URL('/api/file', window.location.origin);
  url.searchParams.set('rel', relativePath);
  return url.toString();
}

async function readLibrary(relativePath: string, start: number, end?: number): Promise<Uint8Array> {
  const headers: HeadersInit = {};
  if (end != null) headers.Range = `bytes=${start}-${end}`;
  else if (start > 0) headers.Range = `bytes=${start}-`;
  const response = await fetch(fileUrl(relativePath), { headers });
  if (!response.ok && response.status !== 206) throw new Error(`Could not read ${relativePath}`);
  return new Uint8Array(await response.arrayBuffer());
}

function filePath(file: File): string {
  return droppedPaths.get(file) || file.webkitRelativePath || file.name;
}

function rootName(paths: string[]): string {
  return paths[0]?.split('/')[0] || 'Folder';
}

async function openDataTransfer(transfer: DataTransfer | null): Promise<void> {
  if (!transfer) return;
  const entries = [...transfer.items].map((item) => item.webkitGetAsEntry?.()).filter((entry): entry is FileSystemEntry => Boolean(entry));
  const files = entries.length > 0 ? (await Promise.all(entries.map((entry) => collectEntry(entry, '')))).flat() : [...transfer.files];
  if (files.length === 0) return;
  await openFileList(files, rootName(files.map(filePath)));
}

async function collectEntry(entry: FileSystemEntry, prefix: string): Promise<File[]> {
  if (entry.name.startsWith('.')) return [];
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    droppedPaths.set(file, `${prefix}${file.name}`);
    return [file];
  }
  if (!entry.isDirectory) return [];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children = await readEntries(reader);
  const nested = await Promise.all(children.map((child) => collectEntry(child, `${prefix}${entry.name}/`)));
  return nested.flat();
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const read = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
          return;
        }
        all.push(...batch);
        read();
      }, reject);
    };
    read();
  });
}

function bindDrop(): void {
  let depth = 0;
  document.addEventListener('dragenter', (event) => {
    event.preventDefault();
    depth += 1;
    document.body.classList.add('is-dragover');
  });
  document.addEventListener('dragover', (event) => event.preventDefault());
  document.addEventListener('dragleave', () => {
    depth -= 1;
    if (depth <= 0) {
      depth = 0;
      document.body.classList.remove('is-dragover');
    }
  });
  document.addEventListener('drop', (event) => {
    event.preventDefault();
    depth = 0;
    document.body.classList.remove('is-dragover');
    void openDataTransfer(event.dataTransfer);
  });
}

function windowLabel(center: number, width: number): string {
  return `WL ${Math.round(center)}  WW ${Math.round(width)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}
