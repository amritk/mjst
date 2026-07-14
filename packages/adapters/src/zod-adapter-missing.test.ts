import { describe, expect, it, vi } from 'vitest'

import { zodToJsonSchema } from './zod-to-json-schema'

// Simulate a project where neither Zod 4's native `toJSONSchema` nor the
// `zod-to-json-schema` fallback is available: `zod` resolves to a build without
// `toJSONSchema`, and `zod-to-json-schema` exposes no usable converter.
vi.mock('zod', () => ({ toJSONSchema: undefined, z: undefined, default: undefined }))
vi.mock('zod-to-json-schema', () => ({ zodToJsonSchema: undefined, default: undefined, ignoreOverride: undefined }))

describe('zodToJsonSchema (no conversion path available)', () => {
  it('throws a clear error naming both zod v4 and the zod-to-json-schema fallback', async () => {
    await expect(zodToJsonSchema({ _def: {} })).rejects.toThrow(
      /requires either 'zod' v4\+.*or the 'zod-to-json-schema' package/s,
    )
  })
})
