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
  })

  it('flags the deprecated fec0::/10 site-local range', () => {
    // Deprecated by RFC 3879 but still routed on plenty of networks, and never
    // public — it used to slip through because only fe80::/10 was checked.
    expect(isPrivateHost('fec0::1')).toBe(true)
    expect(isPrivateHost('feff::1')).toBe(true)
  })

  it('flags the benchmarking and IETF-protocol IPv4 ranges', () => {
    expect(isPrivateHost('198.18.0.1')).toBe(true) // 198.18.0.0/15 benchmarking
    expect(isPrivateHost('198.19.255.255')).toBe(true)
    expect(isPrivateHost('192.0.0.1')).toBe(true) // 192.0.0.0/24 protocol assignments
    // Only the /24 — the rest of 192.0.0.0/16 is ordinary public space.
    expect(isPrivateHost('198.20.0.1')).toBe(false)
    expect(isPrivateHost('192.0.1.1')).toBe(false)
  })

  it('flags cloud-metadata hosts reached by name, not just by IP', () => {
    // The IP check misses these entirely: callers reach the metadata service by
    // name, and `metadata` is what a search domain completes to inside a VPC.
    expect(isPrivateHost('metadata.google.internal')).toBe(true)
    expect(isPrivateHost('metadata.goog')).toBe(true)
    expect(isPrivateHost('metadata')).toBe(true)
    expect(isPrivateHost('instance-data')).toBe(true)
    // The trailing-dot FQDN form must not slip past either.
    expect(isPrivateHost('metadata.google.internal.')).toBe(true)
  })

  it('flags anything under the reserved .internal TLD', () => {
    expect(isPrivateHost('db.internal')).toBe(true)
    expect(isPrivateHost('ip-10-0-0-1.eu-west-1.compute.internal')).toBe(true)
    // A name that merely *contains* "internal" is still public.
    expect(isPrivateHost('internal.example.com')).toBe(false)
    expect(isPrivateHost('myinternal.com')).toBe(false)
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

  it('flags IPv4-compatible / translated / NAT64 IPv6 embeddings the URL parser produces', () => {
    // `new URL('http://[::127.0.0.1]/')` → `::7f00:1` (no `ffff:` marker), which a
    // mapped-only regex missed — the reachable SSRF gap this closes.
    expect(isPrivateHost('::7f00:1')).toBe(true) // ::127.0.0.1
    expect(isPrivateHost('::a9fe:a9fe')).toBe(true) // ::169.254.169.254 (metadata)
    expect(isPrivateHost('::ffff:0:7f00:1')).toBe(true) // IPv4-translated ::ffff:0:127.0.0.1
    expect(isPrivateHost('64:ff9b::7f00:1')).toBe(true) // NAT64-embedded 127.0.0.1
    // The dotted forms a direct caller might pass are caught too.
    expect(isPrivateHost('::127.0.0.1')).toBe(true)
    expect(isPrivateHost('::169.254.169.254')).toBe(true)
    // A compatible/mapped *public* address is still allowed.
    expect(isPrivateHost('::ffff:1.1.1.1')).toBe(false)
    expect(isPrivateHost('2001:db8::a9fe:a9fe')).toBe(false)
  })

  it('flags the fully-expanded IPv6 loopback', () => {
    expect(isPrivateHost('0:0:0:0:0:0:0:1')).toBe(true)
    expect(isPrivateHost('0000:0000:0000:0000:0000:0000:0000:0001')).toBe(true)
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
