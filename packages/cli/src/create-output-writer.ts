import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { ensureOutputDir } from './ensure-output-dir'

/**
 * Record of what mjst has generated into a directory, written at the root of the
 * output directory. It is what lets a rerun replace its own output while still
 * refusing to touch a file somebody wrote by hand — without it, the choice would
 * be between clobbering hand-written files and making every regeneration need
 * `--force`.
 */
const MANIFEST_FILENAME = '.mjst-manifest.json'

/** Existence test that treats any stat failure as "not there". */
const pathExists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  )

/**
 * Reads the paths a previous run claimed, as absolute paths. A missing or
 * unreadable manifest simply means "nothing here is ours yet", which is the safe
 * reading: every existing file is then treated as hand-written.
 */
const readManifest = async (root: string): Promise<Set<string>> => {
  const raw = await readFile(join(root, MANIFEST_FILENAME), 'utf-8').catch(() => undefined)
  if (raw === undefined) return new Set()

  try {
    const parsed = JSON.parse(raw) as { files?: unknown }
    const files = Array.isArray(parsed.files) ? parsed.files : []
    return new Set(files.filter((file): file is string => typeof file === 'string').map((file) => resolve(root, file)))
  } catch {
    return new Set()
  }
}

/**
 * A two-phase writer for one generation run: every file is staged next to its
 * final location under a temporary name, and only once the whole set is on disk
 * are the temporaries renamed into place.
 *
 * Two failure modes drive the design:
 *
 * 1. **Partial trees.** Writing straight to the final paths meant a failure
 *    halfway through (a `_helpers` path occupied by a regular file, a full disk)
 *    left some generated files behind and others missing — a tree that compiles
 *    against a schema that no longer exists. Staging first means the run either
 *    lands completely or leaves the destination as it found it. Renaming is not
 *    one atomic operation across the whole set, but every rename happens after
 *    all the risky work (generating, creating directories, writing bytes) has
 *    already succeeded, so it is the cheapest place to get the guarantee.
 * 2. **Clobbering hand-written files.** A generated name can collide with a file
 *    the user wrote (`index.ts` is the common one), which used to be overwritten
 *    without a word — and then, under `--build`, deleted along with the other
 *    intermediate sources. A file is only replaced when a previous run claimed it
 *    (see {@link MANIFEST_FILENAME}) or `--force` says so, and `--build` is only
 *    ever handed the paths this run actually committed.
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
 * @param rootDir - Output root. Every write must resolve inside it.
 * @param force - Overwrite pre-existing files instead of refusing (`--force`).
 */
export const createOutputWriter = async (rootDir: string, force = false): Promise<OutputWriter> => {
  const root = resolve(rootDir)
  const owned = await readManifest(root)
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

    if (!force && !owned.has(targetPath) && (await pathExists(targetPath))) {
      throw new Error(
        `Refusing to overwrite ${targetPath}: it already exists and was not generated by mjst. ` +
          'Move it aside, choose another output directory, or pass --force to overwrite it.',
      )
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
      owned.add(file.targetPath)
    }

    if (staged.length > 0) {
      // Ownership is cumulative: a path this run no longer emits (a `$ref` that
      // went away) stays ours, so re-adding it later does not look like a
      // hand-written file. Relative paths keep the manifest portable.
      const files = [...owned].map((path) => relative(root, path)).sort()
      await writeFile(join(root, MANIFEST_FILENAME), `${JSON.stringify({ version: 1, files }, null, 2)}\n`, 'utf-8')
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
