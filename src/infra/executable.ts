import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
const sameDirectory = (a: string, b: string) => a === b
/** Resolve a command name or absolute path to an executable file, ignoring the worker shim directory. */
export function executable(name: string, path: string, exclude?: string): string {
  if (name.includes('/') && !isAbsolute(name)) throw new Error(`${name} must be a command name or an absolute path`)
  const candidates = isAbsolute(name)
    ? [name]
    : path
        .split(delimiter)
        .filter((dir) => isAbsolute(dir) && !(exclude && sameDirectory(dir, exclude)))
        .map((dir) => join(dir, name))
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) {
        accessSync(candidate, constants.X_OK)
        return candidate
      }
    } catch {
      /* Not an executable file here; try the next PATH directory. */
    }
  }
  throw new Error(`${name} is not an executable file${isAbsolute(name) ? '' : ' on PATH'}`)
}

