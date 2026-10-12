import path from 'node:path';

export function resolveInside(root: string, relativePath: string): string {
  if (!relativePath || relativePath.includes('\0')) {
    throw new Error('Invalid path');
  }
  const rootResolved = path.resolve(root);
  const absolute = path.resolve(rootResolved, relativePath);
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : `${rootResolved}${path.sep}`;
  if (absolute !== rootResolved && !absolute.startsWith(prefix)) {
    throw new Error('Path escapes library root');
  }
  return absolute;
}
