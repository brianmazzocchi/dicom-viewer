import { parseDicom, type DataSet } from 'dicom-parser';
import { planeFromOrientation, type ParsedDicom } from './model';

function text(dataSet: DataSet, tag: string): string {
  return dataSet.string(tag)?.trim() ?? '';
}

function numberValue(dataSet: DataSet, tag: string): number | undefined {
  const value = dataSet.floatString(tag);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function integerValue(dataSet: DataSet, tag: string): number | undefined {
  const value = dataSet.intString(tag);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const fallback = numberValue(dataSet, tag);
  return fallback == null ? undefined : Math.round(fallback);
}

function orientation(dataSet: DataSet): number[] | undefined {
  const raw = dataSet.string('x00200037');
  if (!raw) return undefined;
  const values = raw.split('\\').map(Number);
  return values.length >= 6 && values.every(Number.isFinite) ? values : undefined;
}

export function parseDicomMeta(bytes: Uint8Array, id: string): ParsedDicom | null {
  let dataSet: DataSet;
  try {
    dataSet = parseDicom(bytes, { untilTag: 'x7fe00010' });
  } catch {
    return null;
  }

  const rows = dataSet.uint16('x00280010');
  const columns = dataSet.uint16('x00280011');
  if (!rows || !columns) return null;

  const instanceNumber = integerValue(dataSet, 'x00200013') ?? 0;
  return {
    id,
    instanceNumber,
    sliceLocation: numberValue(dataSet, 'x00201041'),
    studyInstanceUid: text(dataSet, 'x0020000d'),
    seriesInstanceUid: text(dataSet, 'x0020000e'),
    studyDescription: text(dataSet, 'x00081030'),
    seriesDescription: text(dataSet, 'x0008103e'),
    patientName: text(dataSet, 'x00100010'),
    studyDate: text(dataSet, 'x00080020'),
    modality: text(dataSet, 'x00080060'),
    seriesNumber: integerValue(dataSet, 'x00200011') ?? 0,
    windowCenter: numberValue(dataSet, 'x00281050'),
    windowWidth: numberValue(dataSet, 'x00281051'),
    sliceThickness: numberValue(dataSet, 'x00180050'),
    rows,
    columns,
    plane: planeFromOrientation(orientation(dataSet)),
  };
}
