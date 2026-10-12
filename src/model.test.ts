import { describe, expect, it } from 'vitest';
import {
  buildStudies,
  classifyFile,
  compareFrames,
  formatPatientName,
  formatStudyDate,
  formatThickness,
  planeFromOrientation,
  seriesFolder,
  seriesLabel,
  type ParsedDicom,
} from './model';

function dicom(overrides: Partial<ParsedDicom> & Pick<ParsedDicom, 'id'>): ParsedDicom {
  return {
    instanceNumber: 1,
    studyInstanceUid: 'study-1',
    seriesInstanceUid: 'series-1',
    studyDescription: 'Chest CT',
    seriesDescription: '',
    patientName: 'IHLO^BRIAN',
    studyDate: '20260729',
    modality: 'CT',
    seriesNumber: 1,
    ...overrides,
  };
}

describe('study labels', () => {
  it('formats a DICOM patient name', () => {
    expect(formatPatientName('IHLO^BRIAN')).toBe('IHLO BRIAN');
  });

  it('formats a DICOM date', () => {
    expect(formatStudyDate('20260729')).toBe('2026-07-29');
  });

  it('formats slice thickness without trailing zeros', () => {
    expect(formatThickness(1.5)).toBe('1.5 mm');
    expect(formatThickness(0.4375)).toBe('0.44 mm');
  });

  it('labels an axial stack when the series description is empty', () => {
    expect(seriesLabel('', 'Axial', 4)).toBe('Axial');
    expect(seriesLabel('PULMONAR', 'Axial', 6)).toBe('PULMONAR');
  });

  it('reads the scan plane from image orientation', () => {
    expect(planeFromOrientation([1, 0, 0, 0, 1, 0])).toBe('Axial');
    expect(planeFromOrientation([1, 0, 0, 0, 0, -1])).toBe('Coronal');
    expect(planeFromOrientation([0, 1, 0, 0, 0, -1])).toBe('Sagittal');
  });
});

describe('catalog grouping', () => {
  it('classifies dicom and jpeg files', () => {
    expect(classifyFile('study/DICOM/12.dcm')).toBe('dicom');
    expect(classifyFile('study/JPEG/12.jpg')).toBe('jpeg');
    expect(classifyFile('study/.DS_Store')).toBe('skip');
  });

  it('strips the DICOM or JPEG folder from a series path', () => {
    expect(seriesFolder('TAC/PULMONAR/DICOM/2.dcm')).toBe('TAC/PULMONAR');
    expect(seriesFolder('TAC/PULMONAR/JPEG/2.jpg')).toBe('TAC/PULMONAR');
  });

  it('sorts frames by instance number', () => {
    const frames = [
      { id: '10.dcm', instanceNumber: 10 },
      { id: '2.dcm', instanceNumber: 2 },
    ];
    expect([...frames].sort(compareFrames).map((frame) => frame.id)).toEqual(['2.dcm', '10.dcm']);
  });

  it('groups dicom slices and matching jpegs into one series', () => {
    const studies = buildStudies(
      [
        dicom({
          id: 'TAC/PULMONAR/DICOM/2.dcm',
          instanceNumber: 2,
          seriesInstanceUid: 'pulm',
          seriesDescription: 'PULMONAR',
          seriesNumber: 6,
          sliceLocation: 208,
        }),
        dicom({
          id: 'TAC/PULMONAR/DICOM/1.dcm',
          instanceNumber: 1,
          seriesInstanceUid: 'pulm',
          seriesDescription: 'PULMONAR',
          seriesNumber: 6,
          sliceLocation: 206.5,
        }),
        dicom({
          id: 'TAC/COR/DICOM/1.dcm',
          instanceNumber: 1,
          seriesInstanceUid: 'cor',
          seriesDescription: 'COR',
          seriesNumber: 8,
          plane: 'Coronal',
        }),
      ],
      [
        { id: 'TAC/PULMONAR/JPEG/2.jpg', instanceNumber: 2 },
        { id: 'TAC/PULMONAR/JPEG/1.jpg', instanceNumber: 1 },
      ],
    );

    expect(studies).toHaveLength(1);
    expect(studies[0].patientName).toBe('IHLO BRIAN');
    expect(studies[0].studyDate).toBe('2026-07-29');
    expect(studies[0].series.map((series) => series.description)).toEqual(['PULMONAR', 'COR']);
    expect(studies[0].series[0].frames.map((frame) => frame.instanceNumber)).toEqual([1, 2]);
    expect(studies[0].series[0].jpegs.map((frame) => frame.instanceNumber)).toEqual([1, 2]);
    expect(studies[0].series[1].jpegs).toEqual([]);
  });

  it('names a blank series from its plane', () => {
    const studies = buildStudies(
      [
        dicom({
          id: 'TAC/_/DICOM/1.dcm',
          seriesDescription: '',
          plane: 'Axial',
          seriesNumber: 5,
        }),
      ],
      [],
    );
    expect(studies[0].series[0].description).toBe('Axial');
  });
});
