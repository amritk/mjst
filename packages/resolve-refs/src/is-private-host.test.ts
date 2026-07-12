import { describe, expect, it } from 'vitest'

import { isPrivateHost } from './is-private-host'

describe('is-private-host', () => {
  it('treats localhost and its subdomains as private', () => {
    expect(isPrivateHost('localhost')).toBe(true)
    expect(isPrivateHost('api.localhost')).toBe(true)
  })

  it('treats the FQDN-root (trailing dot) form of localhost as private', () => {
    expect(isPrivateHost('localhost.')).toBe(true)
    expect(isPrivateHost('api.localhost.')).toBe(true)
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

  it('flags the full fe80::/10 link-local range, not just fe80', () => {
    expect(isPrivateHost('fe9a::1')).toBe(true)
    expect(isPrivateHost('feba::1')).toBe(true)
    expect(isPrivateHost('febf::1')).toBe(true)
    // fec0:: is outside fe80::/10 (third nibble c), so it is not link-local.
    expect(isPrivateHost('fec0::1')).toBe(false)
  })

  it('flags IPv4-mapped IPv6 loopback in both dotted and hex form', () => {
    expect(isPrivateHost('::ffff:127.0.0.1')).toBe(true)
    // The form `new URL()` produces for ::ffff:127.0.0.1.
    expect(isPrivateHost('::ffff:7f00:1')).toBe(true)
    // ::ffff:169.254.169.254 (cloud metadata) → hex a9fe:a9fe.
    expect(isPrivateHost('::ffff:a9fe:a9fe')).toBe(true)
    // A mapped public address stays public.
    expect(isPrivateHost('::ffff:8.8.8.8')).toBe(false)
  })

  it('flags decimal/octal/hex IPv4 encodings (defense-in-depth)', () => {
    expect(isPrivateHost('2130706433')).toBe(true) // 127.0.0.1
    expect(isPrivateHost('0177.0.0.1')).toBe(true)
    expect(isPrivateHost('0x7f000001')).toBe(true)
    expect(isPrivateHost('127.1')).toBe(true)
  })

  it('allows public hosts', () => {
    expect(isPrivateHost('example.com')).toBe(false)
    expect(isPrivateHost('8.8.8.8')).toBe(false)
    expect(isPrivateHost('172.32.0.1')).toBe(false)
    // Hostnames made only of hex letters must not be mistaken for IPs.
    expect(isPrivateHost('cafe')).toBe(false)
    expect(isPrivateHost('dead.beef')).toBe(false)
  })
})
