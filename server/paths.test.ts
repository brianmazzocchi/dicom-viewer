import { describe, expect, it } from 'vitest';
import { resolveInside } from './paths';

describe('library paths', () => {
  it('resolves a file inside the library root', () => {
    expect(resolveInside('/library', 'TAC/DICOM/1.dcm')).toBe('/library/TAC/DICOM/1.dcm');
  });

  it('rejects a library path that escapes the root', () => {
    expect(() => resolveInside('/library', '../secret')).toThrow(/escapes/);
    expect(() => resolveInside('/library', '/etc/passwd')).toThrow(/escapes/);
  });
});
