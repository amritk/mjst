import { statSync, watch } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The seam {@link createHotApi} reloads through: hand it a change callback and
 * it returns a disposer. `watchPaths` is the filesystem implementation, but
 * anything that can say "these files changed" fits — a bundler's watcher, a
 * websocket from an editor, a test's manual trigger.
 */
export type Watcher = (onChange: (changed: readonly string[]) => void) => () => void

/**
 * Options for {@link watchPaths}.
 */
export type WatchPathsOptions = {
  /**
   * Extensions that count as a change. Defaults to the source and config files
   * a route module is built from; pass `[]` to accept every file.
   */
  readonly extensions?: readonly string[]
  /** Directory names skipped anywhere under a watched path. */
  readonly ignore?: readonly string[]
  /**
   * How long to wait for the filesystem to go quiet before reporting. A single
   * save often fires several events (and a `git checkout` fires hundreds), so
   * the burst collapses into one reload. Defaults to 40ms.
   */
  readonly debounceMs?: number
}

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'] as const

const DEFAULT_IGNORE = ['node_modules', '.git', 'dist', 'coverage'] as const

/**
 * Watches files and directories for edits and reports them as one debounced
 * batch — the trigger half of a hot reload.
 *
 * Directories are watched recursively. Paths are reported absolute, so the
 * change callback can log them or match them against your own module map.
 * A missing path throws right away: a typo in a watch path is a bug worth
 * hearing about at startup, not a dev server that silently never reloads.
 *
 * @example
 * ```typescript
 * const api = await createHotApi({ load, watch: watchPaths(['src', 'schemas']) })
 * ```
 */
export const watchPaths = (paths: string | readonly string[], options: WatchPathsOptions = {}): Watcher => {
  const roots = (typeof paths === 'string' ? [paths] : paths).map((path) => resolve(path))
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS
  const ignore = options.ignore ?? DEFAULT_IGNORE
  const debounceMs = options.debounceMs ?? 40

  /** `relative` is the path the watcher reported, so the filters read as project paths. */
  const isRelevant = (relative: string): boolean => {
    const segments = relative.split(/[/\\]/)
    if (segments.some((segment) => ignore.includes(segment))) return false
    return extensions.length === 0 || extensions.some((extension) => relative.endsWith(extension))
  }

  return (onChange) => {
    const changed = new Set<string>()
    let timer: ReturnType<typeof setTimeout> | undefined

    const flush = (): void => {
      timer = undefined
      const files = [...changed]
      changed.clear()
      if (files.length > 0) onChange(files)
    }

    const record = (path: string): void => {
      changed.add(path)
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(flush, debounceMs)
      // A pending debounce must never be the reason the process stays alive.
      timer.unref?.()
    }

    const watchers = roots.map((root) => {
      const isDirectory = statSync(root).isDirectory()
      const watcher = watch(root, { recursive: isDirectory }, (_event, filename) => {
        // Watching a single file: there is nothing to filter, the user named it.
        if (!isDirectory) return record(root)
        // Some platforms report no filename. Reloading is the safe answer —
        // a missed edit is worse than an extra rebuild.
        if (filename === null || filename === undefined) return record(root)

        if (isRelevant(filename)) record(resolve(root, filename))
      })
      // A watcher error (a watched directory renamed away, an inotify limit)
      // should not take the dev server down with it.
      watcher.on('error', () => {})
      return watcher
    })

    return () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      for (const watcher of watchers) watcher.close()
    }
  }
}
