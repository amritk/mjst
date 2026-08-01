import { describe, expect, it } from 'vitest'

import { assertPublicHost, type HostLookup } from './assert-public-host'

/** A resolver with fixed answers, so these tests never touch a real one. */
const resolvesTo =
  (...addresses: string[]): HostLookup =>
  () =>
    Promise.resolve(addresses.map((address) => ({ address })))

const fails: HostLookup = () => Promise.reject(new Error('getaddrinfo ENOTFOUND'))

describe('assert-public-host', () => {
  it('accepts a host whose addresses are all public', async () => {
    await expect(assertPublicHost('schemas.example.com', resolvesTo('93.184.216.34'))).resolves.toBeUndefined()
  })

  it('refuses a public-looking name that resolves to loopback (the DNS-rebinding shape)', async () => {
    // The whole reason this exists: `isPrivateHost` sees an ordinary hostname
    // here, and only the lookup reveals the 127.0.0.1 behind it.
    await expect(assertPublicHost('127.0.0.1.nip.io', resolvesTo('127.0.0.1'))).rejects.toThrow(
      /resolves to the non-public address 127\.0\.0\.1/,
    )
  })

  it('refuses when only one of several addresses is private', async () => {
    // A public A record alongside a private one must not launder the private one.
    await expect(assertPublicHost('mixed.example.com', resolvesTo('93.184.216.34', '169.254.169.254'))).rejects.toThrow(
      /169\.254\.169\.254/,
    )
  })

  it('refuses a private IPv6 answer', async () => {
    await expect(assertPublicHost('rebind.example.com', resolvesTo('::1'))).rejects.toThrow(/non-public address ::1/)
  })

  it('refuses a syntactically private host without resolving it', async () => {
    let called = false
    const lookupHost: HostLookup = () => {
      called = true
      return Promise.resolve([{ address: '93.184.216.34' }])
    }
    await expect(assertPublicHost('169.254.169.254', lookupHost)).rejects.toThrow(/private or loopback/)
    expect(called).toBe(false)
  })

  it('refuses a metadata host by name without resolving it', async () => {
    await expect(assertPublicHost('metadata.google.internal', resolvesTo('93.184.216.34'))).rejects.toThrow(
      /private or loopback/,
    )
  })

  it('fails closed when the lookup errors', async () => {
    // We cannot show the host is public, so we refuse rather than assume.
    await expect(assertPublicHost('unresolvable.example.com', fails)).rejects.toThrow(/DNS lookup failed/)
  })

  it('fails closed when the lookup returns no addresses', async () => {
    await expect(assertPublicHost('empty.example.com', resolvesTo())).rejects.toThrow(/DNS returned no addresses/)
  })

  it('normalizes brackets and the trailing FQDN dot before checking', async () => {
    await expect(assertPublicHost('[::1]', resolvesTo())).rejects.toThrow(/private or loopback/)
    await expect(assertPublicHost('localhost.', resolvesTo())).rejects.toThrow(/private or loopback/)
  })

  it('refuses an empty host', async () => {
    await expect(assertPublicHost('', resolvesTo('93.184.216.34'))).rejects.toThrow(/host is empty/)
  })
})
