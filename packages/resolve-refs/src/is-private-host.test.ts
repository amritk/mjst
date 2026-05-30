import { describe, expect, it } from 'vitest'

import { isPrivateHost } from './is-private-host'

describe('is-private-host', () => {
  it('treats localhost and its subdomains as private', () => {
    expect(isPrivateHost('localhost')).toBe(true)
    expect(isPrivateHost('api.localhost')).toBe(true)
  })

  it('flags loopback and RFC 1918 / CGNAT IPv4 ranges', () => {
    expect(isPrivateHost('127.0.0.1')).toBe(true)
    expect(isPrivateHost('10.1.2.3')).toBe(true)
    expect(isPrivateHost('172.16.0.1')).toBe(true)
    expect(isPrivateHost('172.31.255.255')).toBe(true)
    expect(isPrivateHost('192.168.0.1')).toBe(true)
    expect(isPrivateHost('100.64.0.1')).toBe(true)
  })

  it('flags the cloud-metadata link-local endpoint', () => {
    expect(isPrivateHost('169.254.169.254')).toBe(true)
  })

  it('flags private IPv6 (loopback, link-local, unique-local)', () => {
    expect(isPrivateHost('::1')).toBe(true)
    expect(isPrivateHost('[::1]')).toBe(true)
    expect(isPrivateHost('fe80::1')).toBe(true)
    expect(isPrivateHost('fd00::1')).toBe(true)
  })

  it('allows public hosts', () => {
    expect(isPrivateHost('example.com')).toBe(false)
    expect(isPrivateHost('8.8.8.8')).toBe(false)
    expect(isPrivateHost('172.32.0.1')).toBe(false)
  })
})
