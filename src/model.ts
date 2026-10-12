export type FrameRef = {
  id: string;
  instanceNumber: number;
  sliceLocation?: number;
};

export type ParsedDicom = FrameRef & {
  studyInstanceUid: string;
  seriesInstanceUid: string;
  studyDescription: string;
  seriesDescription: string;
  patientName: string;
  studyDate: string;
  modality: string;
  seriesNumber: number;
  windowCenter?: number;
  windowWidth?: number;
  sliceThickness?: number;
  rows?: number;
  columns?: number;
  plane?: string;
};

export type SeriesEntry = {
  id: string;
  description: string;
  modality: string;
  seriesNumber: number;
  windowCenter?: number;
  windowWidth?: number;
  sliceThickness?: number;
  rows?: number;
  columns?: number;
  frames: FrameRef[];
  jpegs: FrameRef[];
};

export type StudyEntry = {
  id: string;
  description: string;
  patientName: string;
  studyDate: string;
  series: SeriesEntry[];
};

export type WindowPreset = {
  id: string;
  label: string;
  center: number;
  width: number;
};

export const WINDOW_PRESETS: WindowPreset[] = [
  { id: 'abdomen', label: 'Abdomen', center: 40, width: 400 },
  { id: 'lung', label: 'Lung', center: -600, width: 1500 },
  { id: 'brain', label: 'Brain', center: 40, width: 80 },
  { id: 'bone', label: 'Bone', center: 300, width: 1500 },
];

export function formatPatientName(value: string): string {
  return value.replaceAll('^', ' ').replace(/\s+/g, ' ').trim();
}

export function formatStudyDate(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8) return value.trim();
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

export function formatThickness(value?: number): string {
  if (value == null || !Number.isFinite(value)) return '';
  const rounded = value >= 10 ? value.toFixed(0) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${rounded} mm`;
}

export function planeFromOrientation(orientation?: number[]): string | undefined {
  if (!orientation || orientation.length < 6) return undefined;
  const row = orientation.slice(0, 3);
  const column = orientation.slice(3, 6);
  const normal = [
    row[1] * column[2] - row[2] * column[1],
    row[2] * column[0] - row[0] * column[2],
    row[0] * column[1] - row[1] * column[0],
  ];
  const magnitude = normal.map((value) => Math.abs(value));
  const max = Math.max(...magnitude);
  if (max < 0.5) return undefined;
  if (magnitude[2] === max) return 'Axial';
  if (magnitude[1] === max) return 'Coronal';
  return 'Sagittal';
}

export function seriesLabel(description: string, plane?: string, seriesNumber?: number): string {
  const clean = description.trim();
  if (clean) return clean;
  if (plane) return plane;
  if (seriesNumber != null && Number.isFinite(seriesNumber)) return `Series ${seriesNumber}`;
  return 'Series';
}

export function classifyFile(relativePath: string): 'dicom' | 'jpeg' | 'skip' {
  const name = relativePath.split('/').pop()?.toLowerCase() ?? '';
  if (!name || name.startsWith('.')) return 'skip';
  if (name.endsWith('.dcm') || name.endsWith('.dicom')) return 'dicom';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'jpeg';
  if (!name.includes('.')) return 'dicom';
  return 'skip';
}

export function seriesFolder(relativePath: string): string {
  const parts = relativePath.split('/').filter(Boolean);
  parts.pop();
  const leaf = parts[parts.length - 1];
  if (leaf && /^(dicom|jpe?g)$/i.test(leaf)) parts.pop();
  return parts.join('/');
}

export function instanceNumberFromName(relativePath: string): number {
  const name = relativePath.split('/').pop() ?? '';
  const match = /(\d+)/.exec(name);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function compareFrames(a: FrameRef, b: FrameRef): number {
  if (a.instanceNumber !== b.instanceNumber) return a.instanceNumber - b.instanceNumber;
  return a.id.localeCompare(b.id, undefined, { numeric: true });
}

export function buildStudies(dicoms: ParsedDicom[], jpegs: FrameRef[]): StudyEntry[] {
  const studies = new Map<string, StudyEntry>();
  const seriesById = new Map<string, SeriesEntry>();
  const seriesByFolder = new Map<string, SeriesEntry>();

  const ordered = [...dicoms].sort(compareFrames);
  for (const dicom of ordered) {
    const studyId = dicom.studyInstanceUid || 'unknown-study';
    let study = studies.get(studyId);
    if (!study) {
      study = {
        id: studyId,
        description: dicom.studyDescription.trim() || 'Study',
        patientName: formatPatientName(dicom.patientName),
        studyDate: formatStudyDate(dicom.studyDate),
        series: [],
      };
      studies.set(studyId, study);
    }

    const seriesId = dicom.seriesInstanceUid || `${studyId}:${seriesFolder(dicom.id)}`;
    let series = seriesById.get(seriesId);
    if (!series) {
      series = {
        id: seriesId,
        description: seriesLabel(dicom.seriesDescription, dicom.plane, dicom.seriesNumber),
        modality: dicom.modality || 'OT',
        seriesNumber: dicom.seriesNumber,
        windowCenter: dicom.windowCenter,
        windowWidth: dicom.windowWidth,
        sliceThickness: dicom.sliceThickness,
        rows: dicom.rows,
        columns: dicom.columns,
        frames: [],
        jpegs: [],
      };
      seriesById.set(seriesId, series);
      seriesByFolder.set(seriesFolder(dicom.id), series);
      study.series.push(series);
    }
    series.frames.push({
      id: dicom.id,
      instanceNumber: dicom.instanceNumber,
      sliceLocation: dicom.sliceLocation,
    });
  }

  for (const jpeg of [...jpegs].sort(compareFrames)) {
    const folder = seriesFolder(jpeg.id);
    const series = seriesByFolder.get(folder);
    if (series) {
      series.jpegs.push(jpeg);
      continue;
    }
    const study = studies.values().next().value ?? {
      id: 'jpeg-study',
      description: 'JPEG images',
      patientName: '',
      studyDate: '',
      series: [],
    };
    if (!studies.has(study.id)) studies.set(study.id, study);
    const created: SeriesEntry = {
      id: `jpeg:${folder || jpeg.id}`,
      description: folder.split('/').pop() || 'JPEG',
      modality: 'OT',
      seriesNumber: Number.MAX_SAFE_INTEGER,
      frames: [],
      jpegs: [jpeg],
    };
    seriesByFolder.set(folder, created);
    study.series.push(created);
  }

  for (const study of studies.values()) {
    study.series.sort((a, b) => a.seriesNumber - b.seriesNumber || a.description.localeCompare(b.description));
    for (const series of study.series) {
      series.frames.sort(compareFrames);
      series.jpegs.sort(compareFrames);
    }
  }

  return [...studies.values()].sort((a, b) => a.studyDate.localeCompare(b.studyDate) || a.description.localeCompare(b.description));
}

export function findSeries(studies: StudyEntry[], seriesId: string): { study: StudyEntry; series: SeriesEntry } | undefined {
  for (const study of studies) {
    const series = study.series.find((entry) => entry.id === seriesId);
    if (series) return { study, series };
  }
  return undefined;
}
