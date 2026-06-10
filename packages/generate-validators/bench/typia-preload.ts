/**
 * Bun preload that registers the unplugin-typia transformer, so files importing
 * `typia` (here, `typia-validators.ts`) get typia's compile-time codegen applied
 * on import. Only the `typia` benchmark worker is spawned with this preload, so
 * the other libraries stay in pristine, transform-free processes.
 *
 *   bun --preload ./bench/typia-preload.ts ./bench/worker.ts <case> typia
 *
 * `log: false` keeps the plugin's banner off stdout (the worker writes its JSON
 * result there); `cache: true` reuses the transformed output across the many
 * worker spawns one full benchmark run makes.
 */

import UnpluginTypia from '@ryoppippi/unplugin-typia/bun'
import { plugin } from 'bun'

plugin(UnpluginTypia({ log: false, cache: true }))
