import type { MouseTool } from './engine';

type BitmapSource = () => Promise<ImageBitmap>;

export class JpegStack {
  private sources: BitmapSource[] = [];
  private cache = new Map<number, ImageBitmap>();
  private recent: number[] = [];
  private index = 0;
  private scale = 1;
  private panX = 0;
  private panY = 0;
  private brightness = 1;
  private contrast = 1;
  private inverted = false;
  private drawToken = 0;
  private readonly context: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');
    this.context = context;
  }

  async open(sources: BitmapSource[], index: number): Promise<void> {
    this.clearCache();
    this.sources = sources;
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.brightness = 1;
    this.contrast = 1;
    this.inverted = false;
    this.canvas.classList.add('is-active');
    await this.go(index);
  }

  hide(): void {
    this.canvas.classList.remove('is-active');
  }

  get length(): number {
    return this.sources.length;
  }

  async go(index: number): Promise<void> {
    if (this.sources.length === 0) return;
    this.index = clamp(index, 0, this.sources.length - 1);
    await this.draw();
    void this.prefetch(this.index + 1);
    void this.prefetch(this.index - 1);
  }

  drag(tool: MouseTool, dx: number, dy: number): void {
    if (tool === 'pan') {
      this.panX += dx;
      this.panY += dy;
    } else if (tool === 'zoom') {
      this.scale = clamp(this.scale * Math.exp(-dy * 0.01), 0.25, 12);
    } else {
      this.brightness = clamp(this.brightness - dy * 0.004, 0.2, 3);
      this.contrast = clamp(this.contrast + dx * 0.004, 0.2, 3);
    }
    void this.draw();
  }

  toggleInvert(): boolean {
    this.inverted = !this.inverted;
    void this.draw();
    return this.inverted;
  }

  reset(): void {
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.brightness = 1;
    this.contrast = 1;
    this.inverted = false;
    void this.draw();
  }

  resize(): void {
    if (!this.canvas.classList.contains('is-active')) return;
    void this.draw();
  }

  private async draw(): Promise<void> {
    const token = ++this.drawToken;
    const bitmap = await this.bitmap(this.index);
    if (!bitmap || token !== this.drawToken) return;
    const bounds = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(bounds.width * ratio));
    const height = Math.max(1, Math.floor(bounds.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const context = this.context;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
    const fit = Math.min(width / bitmap.width, height / bitmap.height) * this.scale;
    context.setTransform(fit, 0, 0, fit, width / 2 + this.panX * ratio, height / 2 + this.panY * ratio);
    context.filter = `${this.inverted ? 'invert(1) ' : ''}brightness(${this.brightness}) contrast(${this.contrast})`;
    context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    context.filter = 'none';
  }

  private async bitmap(index: number): Promise<ImageBitmap | undefined> {
    const cached = this.cache.get(index);
    if (cached) {
      this.touch(index);
      return cached;
    }
    const source = this.sources[index];
    if (!source) return undefined;
    const bitmap = await source();
    this.cache.set(index, bitmap);
    this.touch(index);
    while (this.recent.length > 24) {
      const evict = this.recent.shift();
      if (evict == null || evict === this.index) continue;
      this.cache.get(evict)?.close();
      this.cache.delete(evict);
    }
    return bitmap;
  }

  private touch(index: number): void {
    const existing = this.recent.indexOf(index);
    if (existing >= 0) this.recent.splice(existing, 1);
    this.recent.push(index);
  }

  private async prefetch(index: number): Promise<void> {
    if (index < 0 || index >= this.sources.length || this.cache.has(index)) return;
    await this.bitmap(index);
  }

  private clearCache(): void {
    for (const bitmap of this.cache.values()) bitmap.close();
    this.cache.clear();
    this.recent = [];
    this.sources = [];
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
