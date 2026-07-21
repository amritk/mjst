import { describe, expect, it } from 'vitest'

import { createSignedCookies, signCookie, unsignCookie } from './sign-cookie'

describe('sign-cookie', () => {
  it('round-trips a signed value', async () => {
    const signed = await signCookie('session-42', 'secret')
    expect(signed).toMatch(/^session-42\./)
    expect(await unsignCookie(signed, 'secret')).toBe('session-42')
  })

  it('rejects a value signed with a different secret', async () => {
    const signed = await signCookie('session-42', 'secret')
    expect(await unsignCookie(signed, 'other-secret')).toBeUndefined()
  })

  it('rejects a tampered value', async () => {
    const signed = await signCookie('admin=false', 'secret')
    const tampered = signed.replace('admin=false', 'admin=true')
    expect(await unsignCookie(tampered, 'secret')).toBeUndefined()
  })

  it('rejects an unsigned or malformed value', async () => {
    expect(await unsignCookie('nodot', 'secret')).toBeUndefined()
    expect(await unsignCookie('.onlysig', 'secret')).toBeUndefined()
    expect(await unsignCookie('value.!!!not-base64!!!', 'secret')).toBeUndefined()
  })

  it('preserves values containing dots', async () => {
    const signed = await signCookie('a.b.c', 'secret')
    expect(await unsignCookie(signed, 'secret')).toBe('a.b.c')
  })

  it('exposes a bound sign/unsign pair', async () => {
    const cookies = createSignedCookies('secret')
    const signed = await cookies.sign('x')
    expect(await cookies.unsign(signed)).toBe('x')
  })
})
