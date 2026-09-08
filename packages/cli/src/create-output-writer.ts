import { rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

import { ensureOutputDir } from './ensure-output-dir'

/**
 * A two-phase writer for one generation run: every file is staged next to its
 * final location under a temporary name, and only once the whole set is on disk
 * are the temporaries renamed into place.
 *
 * The failure mode it exists for is **partial trees**. Writing straight to the
 * final paths meant a failure halfway through (a `_helpers` path occupied by a
 * regular file, a full disk) left some generated files behind and others missing
 * — a tree that compiles against a schema that no longer exists. Staging first
 * means the run either lands completely or leaves the destination as it found it.
 * Renaming is not one atomic operation across the whole set, but every rename
 * happens after all the risky work (generating, creating directories, writing
 * bytes) has already succeeded, so it is the cheapest place to get the guarantee.
 *
 * A generated path that already exists is simply replaced. The writer keeps no
 * record of what it produced last time: an output directory is generated output,
 * and version control is where a user sees — and reverts — a replacement they did
 * not want. What the writer still guarantees is that `--build` only ever deletes
 * intermediate sources this run committed, so nothing that was already sitting in
 * the output directory is removed.
 */
export type OutputWriter = {
  /**
   * Stages one file. `relativePath` is relative to the writer's root and may
   * contain subdirectories; parent directories are created eagerly.
   */
  readonly stage: (relativePath: string, content: string) => Promise<void>
  /** Moves every staged file to its final path and returns the committed paths. */
  readonly commit: () => Promise<string[]>
  /** Deletes the staged temporaries; call this when the run fails before committing. */
  readonly discard: () => Promise<void>
}

/** A staged file: where its bytes currently live, and where they belong. */
type StagedFile = {
  readonly relativePath: string
  readonly targetPath: string
  readonly tempPath: string
}

/**
 * Creates an {@link OutputWriter} rooted at `rootDir`.
 *
 * Still async with nothing to await: it read the previous run's manifest here
 * until that was removed, and every call site already awaits it. Keeping the
 * signature leaves room for setup that does need I/O.
 *
 * @param rootDir - Output root. Every write must resolve inside it.
 */
export const createOutputWriter = async (rootDir: string): Promise<OutputWriter> => {
  const root = resolve(rootDir)
  const staged: StagedFile[] = []
  // Unique per writer so two mjst runs sharing an output directory cannot pick
  // the same temporary name and stomp on each other's staged bytes.
  const stamp = `${process.pid}-${Date.now().toString(36)}`

  const stage = async (relativePath: string, content: string): Promise<void> => {
    const targetPath = resolve(root, relativePath)

    // Filenames are derived from schema-supplied names (the root type, `$ref`
    // targets), so a name like `../../escaped` would otherwise write outside the
    // output directory entirely. The name sources validate themselves, but this
    // is the backstop that holds no matter which one grows a new hole.
    if (targetPath !== root && !targetPath.startsWith(root + sep)) {
      throw new Error(`Refusing to write "${relativePath}": it resolves outside the output directory ${root}.`)
    }

    const tempPath = `${targetPath}.mjst-${stamp}-${staged.length}.tmp`
    // Reused for its error message: a generated subdirectory (`_helpers/`) whose
    // path is occupied by a regular file otherwise fails with a bare EEXIST.
    await ensureOutputDir(dirname(targetPath))
    await writeFile(tempPath, content, 'utf-8')
    staged.push({ relativePath, targetPath, tempPath })
  }

  const commit = async (): Promise<string[]> => {
    for (const file of staged) {
      await rename(file.tempPath, file.targetPath)
    }

    return staged.map((file) => file.relativePath)
  }

  const discard = async (): Promise<void> => {
    // Best-effort: the run is already failing, and a leftover `.tmp` file is a far
    // smaller problem than masking the original error with a cleanup error.
    for (const file of staged) {
      await rm(file.tempPath, { force: true }).catch(() => undefined)
    }
  }

  return { stage, commit, discard }
}
