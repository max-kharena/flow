// Helpers the build tools share. No dependencies, so any tool can import it
// without loading esbuild.
import { readdirSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('..', import.meta.url));

export const posix = (p) => p.split(sep).join('/');

// Every file under `dir`; `skip(name)` leaves out a file or a whole folder.
export function walk(dir, skip = () => false, out = []) {
  for (const name of readdirSync(dir)) {
    if (skip(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, skip, out);
    else out.push(full);
  }
  return out;
}

// True when the module at `url` is the script node was started with (also
// through a symlinked path, as macOS temp folders are).
export const isMain = (url) => Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(url);
