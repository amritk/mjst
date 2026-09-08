import { describe, expect, it } from 'vitest'

import { extractAsyncApi } from './extract-async-api'
import { DEFAULT_DISCRIMINATOR, resolveDiscriminator } from './resolve-discriminator'
import type { NormalizedChannel } from './types'

const channel = (discriminator?: string): NormalizedChannel => ({
  key: 'lobby',
  messages: [],
  ...(discriminator !== undefined ? { discriminator } : {}),
})

describe('resolve-discriminator', () => {
  it("defaults to 'type', matching @amritk/api", () => {
    expect(resolveDiscriminator(channel())).toBe('type')
    expect(DEFAULT_DISCRIMINATOR).toBe('type')
  })

  it('takes the override when the channel declares nothing', () => {
    expect(resolveDiscriminator(channel(), 'event')).toBe('event')
  })

  it("prefers the channel's own declaration over the override", () => {
    // One `--discriminator` covers a whole run, and a run may span channels
    // that disagree. The channel that wrote its answer down keeps it.
    expect(resolveDiscriminator(channel('kind'), 'event')).toBe('kind')
  })

  it('reads the declaration off an x-mjst extension on a 3.0 channel', () => {
    const model = extractAsyncApi({
      asyncapi: '3.0.0',
      info: { title: 'Chat', version: '1.0.0' },
      channels: { lobby: { address: '/lobby', 'x-mjst': { discriminator: 'event' }, messages: {} } },
    })
    expect(resolveDiscriminator(model.channels[0] as NormalizedChannel)).toBe('event')
  })

  it('reads it off a 2.x channel too', () => {
    const model = extractAsyncApi({
      asyncapi: '2.6.0',
      info: { title: 'Chat', version: '1.0.0' },
      channels: { '/lobby': { 'x-mjst': { discriminator: 'event' } } },
    })
    expect(resolveDiscriminator(model.channels[0] as NormalizedChannel)).toBe('event')
  })

  // The name is emitted into generated TypeScript inside a quoted literal, so a
  // value that could end that literal is refused rather than written out.
  it('ignores a declaration that could not be emitted safely', () => {
    const model = extractAsyncApi({
      asyncapi: '3.0.0',
      info: { title: 'Chat', version: '1.0.0' },
      channels: { lobby: { 'x-mjst': { discriminator: "type', evil: '" }, messages: {} } },
    })
    expect(resolveDiscriminator(model.channels[0] as NormalizedChannel, 'event')).toBe('event')
  })
})
