import { classifyFile, instanceNumberFromName, buildStudies, type FrameRef, type ParsedDicom, type StudyEntry } from './model';
import { parseDicomMeta } from './dicom-meta';

const HEADER_BYTES = 32 * 1024;

export type CatalogInput = {
  relativePath: string;
  read(start: number, end?: number): Promise<Uint8Array>;
};

async function mapPool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, () => run()));
  return results;
}

export async function catalogFromEntries(
  entries: CatalogInput[],
  onProgress?: (done: number, total: number) => void,
): Promise<StudyEntry[]> {
  const dicomEntries = entries.filter((entry) => classifyFile(entry.relativePath) === 'dicom');
  const jpegs: FrameRef[] = entries
    .filter((entry) => classifyFile(entry.relativePath) === 'jpeg')
    .map((entry) => ({
      id: entry.relativePath,
      instanceNumber: instanceNumberFromName(entry.relativePath),
    }));

  let done = 0;
  onProgress?.(0, dicomEntries.length);
  const parsed = await mapPool(dicomEntries, 24, async (entry) => {
    const header = await readMeta(entry);
    done += 1;
    onProgress?.(done, dicomEntries.length);
    return header;
  });

  const dicoms = parsed.filter((entry): entry is ParsedDicom => entry != null);
  return buildStudies(dicoms, jpegs);
}

async function readMeta(entry: CatalogInput): Promise<ParsedDicom | null> {
  const partial = parseDicomMeta(await entry.read(0, HEADER_BYTES - 1), entry.relativePath);
  if (partial) return partial;
  return parseDicomMeta(await entry.read(0), entry.relativePath);
}
