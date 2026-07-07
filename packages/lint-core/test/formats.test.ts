import { describe, expect, it } from 'vitest'

import { detectFormats, type Format } from '../src/index'

describe('detectFormats', () => {
  it('detects nothing when no format registry is supplied (the engine is format-agnostic)', () => {
    expect(detectFormats({ openapi: '3.1.0' })).toEqual(new Set())
    expect(detectFormats({ anything: true })).toEqual(new Set())
  })

  it('reports the names of every custom detector that matches', () => {
    const registry: Record<string, Format> = {
      hasVersion: (d) => typeof d === 'object' && d !== null && 'version' in d,
      hasServices: (d) => typeof d === 'object' && d !== null && 'services' in d,
      never: () => false,
    }
    expect(detectFormats({ version: 1, services: {} }, registry)).toEqual(new Set(['hasVersion', 'hasServices']))
    expect(detectFormats({ version: 1 }, registry)).toEqual(new Set(['hasVersion']))
  })
})
