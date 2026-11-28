import { describe, expect, it } from 'vitest'

import { type HostLookup, resolvePublicHost } from './resolve-public-host'

/** A resolver with fixed answers, so these tests never touch a real one. */
const resolvesTo =
  (...addresses: string[]): HostLookup =>
  () =>
    Promise.resolve(addresses.map((address) => ({ address })))

describe('resolve-public-host', () => {
  it('returns every public address with its family', async () => {
    await expect(
      resolvePublicHost('schemas.example.com', resolvesTo('93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946')),
    ).resolves.toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ])
  })

  it('resolves the name exactly once', async () => {
    // The addresses returned are the ones a pinned connection dials, so a second
    // lookup here would reopen the window a rebinding record needs.
    const asked: string[] = []
    const lookupHost: HostLookup = (hostname) => {
      asked.push(hostname)
      return Promise.resolve([{ address: '93.184.216.34' }])
    }

    await resolvePublicHost('Schemas.Example.com.', lookupHost)

    expect(asked).toEqual(['schemas.example.com'])
  })

  it('refuses when any address is private', async () => {
    await expect(resolvePublicHost('mixed.example.com', resolvesTo('93.184.216.34', '10.0.0.5'))).rejects.toThrow(
      /non-public address 10\.0\.0\.5/,
    )
  })

  it('refuses an answer that is not an IP address', async () => {
    // Dialing a name would mean resolving it again, unchecked.
    await expect(resolvePublicHost('cname.example.com', resolvesTo('internal.example.com'))).rejects.toThrow(
      /not an IP address/,
    )
  })

  it('refuses a private IP literal without resolving it', async () => {
    let called = false
    const lookupHost: HostLookup = () => {
      called = true
      return Promise.resolve([])
    }

    await expect(resolvePublicHost('[::1]', lookupHost)).rejects.toThrow(/private or loopback/)
    expect(called).toBe(false)
  })
})
