import {
  cache,
  Enums,
  RenderingEngine,
  init as coreInit,
  utilities,
  type Types,
} from '@cornerstonejs/core';
import {
  PanTool,
  StackScrollTool,
  ToolGroupManager,
  WindowLevelTool,
  ZoomTool,
  addTool,
  init as toolsInit,
  Enums as toolEnums,
  type Types as ToolTypes,
} from '@cornerstonejs/tools';
import cornerstoneDICOMImageLoader, { init as dicomImageLoaderInit } from '@cornerstonejs/dicom-image-loader';

const ENGINE_ID = 'viewer';
const VIEWPORT_ID = 'stack';
const TOOL_GROUP_ID = 'stack-tools';

export type MouseTool = 'window' | 'zoom' | 'pan';

const fileIds = new WeakMap<File, string>();
let renderingEngine: RenderingEngine | undefined;
let viewport: Types.IStackViewport | undefined;
let toolGroup: ToolTypes.IToolGroup | undefined;
let element: HTMLDivElement | undefined;

const toolNames: Record<MouseTool, string> = {
  window: WindowLevelTool.toolName,
  zoom: ZoomTool.toolName,
  pan: PanTool.toolName,
};

export async function initEngine(host: HTMLDivElement): Promise<void> {
  if (viewport) return;
  element = host;
  await coreInit();
  const cores = navigator.hardwareConcurrency || 4;
  dicomImageLoaderInit({
    maxWebWorkers: Math.max(2, Math.min(6, cores - 2)),
    // The naturalized loader drops encapsulated JPEG 2000 frames from local files.
    useLegacyMetadataProvider: true,
  });
  await toolsInit();
  cache.setMaxCacheSize(1024 * 1024 * 1024);

  addTool(WindowLevelTool);
  addTool(PanTool);
  addTool(ZoomTool);
  addTool(StackScrollTool);

  const group = ToolGroupManager.createToolGroup(TOOL_GROUP_ID);
  if (!group) throw new Error('Could not create the tool group');
  toolGroup = group;
  group.addTool(WindowLevelTool.toolName);
  group.addTool(PanTool.toolName);
  group.addTool(ZoomTool.toolName);
  group.addTool(StackScrollTool.toolName);
  group.setToolConfiguration(StackScrollTool.toolName, { loop: false, debounceIfNotLoaded: true });

  const background: Types.Point3 = [0, 0, 0];
  renderingEngine = new RenderingEngine(ENGINE_ID);
  renderingEngine.enableElement({
    viewportId: VIEWPORT_ID,
    type: Enums.ViewportType.STACK,
    element: host,
    defaultOptions: { background },
  });
  const created = renderingEngine.getViewport(VIEWPORT_ID) as Types.IStackViewport | undefined;
  if (!created) throw new Error('Could not create the viewport');
  viewport = created;
  group.addViewport(VIEWPORT_ID, ENGINE_ID);
  setMouseTool('window');
  host.addEventListener('contextmenu', (event) => event.preventDefault());
}

export function imageIdForFile(file: File): string {
  const existing = fileIds.get(file);
  if (existing) return existing;
  const imageId = cornerstoneDICOMImageLoader.wadouri.fileManager.add(file);
  fileIds.set(file, imageId);
  return imageId;
}

export async function showStack(imageIds: string[], index: number): Promise<void> {
  if (!viewport || !element) throw new Error('Viewer is not ready');
  element.classList.add('is-active');
  renderingEngine?.resize(true, false);
  await viewport.setStack(imageIds, index);
  viewport.render();
}

export function hideStack(): void {
  element?.classList.remove('is-active');
}

export async function setIndex(index: number): Promise<void> {
  if (!viewport) return;
  await viewport.setImageIdIndex(index);
}

export function setWindow(center: number, width: number): void {
  if (!viewport) return;
  viewport.setProperties({ voiRange: utilities.windowLevel.toLowHighRange(width, center) });
  viewport.render();
}

export function toggleInvert(): boolean {
  if (!viewport) return false;
  const inverted = !viewport.getProperties().invert;
  viewport.setProperties({ invert: inverted });
  viewport.render();
  return inverted;
}

export function resetView(): void {
  if (!viewport) return;
  viewport.resetCamera();
  viewport.resetProperties();
  viewport.render();
}

export function currentWindow(): { center: number; width: number } | undefined {
  const range = viewport?.getProperties().voiRange;
  if (!range) return undefined;
  const voi = utilities.windowLevel.toWindowLevel(range.lower, range.upper);
  return { center: voi.windowCenter, width: voi.windowWidth };
}

export function resize(): void {
  renderingEngine?.resize();
}

export function setMouseTool(tool: MouseTool): void {
  if (!toolGroup) return;
  const { MouseBindings } = toolEnums;
  const primary = toolNames[tool];
  const bindings: Record<string, number[]> = {
    [WindowLevelTool.toolName]: [],
    [ZoomTool.toolName]: [MouseBindings.Secondary],
    [PanTool.toolName]: [MouseBindings.Auxiliary],
  };
  bindings[primary].push(MouseBindings.Primary);
  for (const [name, buttons] of Object.entries(bindings)) {
    const unique = [...new Set(buttons)];
    if (unique.length === 0) toolGroup.setToolPassive(name);
    else toolGroup.setToolActive(name, { bindings: unique.map((mouseButton) => ({ mouseButton })) });
  }
  toolGroup.setToolActive(StackScrollTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Wheel }],
  });
}

export function onStackIndex(listener: (index: number) => void): void {
  element?.addEventListener(Enums.Events.STACK_NEW_IMAGE, (event) => {
    const index = (event as CustomEvent<{ imageIdIndex?: number }>).detail?.imageIdIndex;
    if (typeof index === 'number') listener(index);
  });
}

export function onWindowLevel(listener: (center: number, width: number) => void): void {
  element?.addEventListener(Enums.Events.VOI_MODIFIED, (event) => {
    const range = (event as CustomEvent<{ range?: { lower: number; upper: number } }>).detail?.range;
    if (!range) return;
    const voi = utilities.windowLevel.toWindowLevel(range.lower, range.upper);
    listener(voi.windowCenter, voi.windowWidth);
  });
}
