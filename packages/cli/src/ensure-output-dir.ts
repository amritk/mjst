import { mkdir } from 'node:fs/promises'

/**
 * Creates the output directory, translating the two ways a path can already be
 * taken by something that is not a directory into an actionable message.
 *
 * `mkdir --out-dir` on an existing *file* fails with a raw
 * `EEXIST: file already exists, mkdir '/abs/path'` (and `ENOTDIR` when a file sits
 * midway through the path), which reads like an mjst bug rather than "you pointed
 * --out-dir at a file".
 */
export const ensureOutputDir = async (dir: string): Promise<void> => {
  try {
    await mkdir(dir, { recursive: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST' || code === 'ENOTDIR') {
      throw new Error(`Cannot use ${dir} as the output directory: a file already exists at that path.`)
    }
    throw error
  }
}
