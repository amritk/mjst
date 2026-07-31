import { describe, expect, it } from 'vitest'

import { withAllowedRootsHint } from './allowed-roots-hint'

describe('allowed-roots-hint', () => {
  it('names the CLI flag on the "outside the allowed roots" refusal', () => {
    const message =
      'Refusing to read local $ref (it resolves outside the allowed roots [/specs/v1] ' +
      '(set allowedRoots to permit it)): /specs/common/user.json'

    expect(withAllowedRootsHint(message)).toContain('pass --allowed-roots <dir>')
  })

  // The resolver has a second refusal wording for a document with no local
  // neighbourhood at all (a remote root); both point at the same option, so both
  // have to pick up the same CLI guidance.
  it('names the CLI flag on the "no local directory is allowed" refusal', () => {
    const message =
      'Refusing to read local $ref (no local directory is allowed for this document ' +
      '(set allowedRoots to permit one)): /etc/passwd'

    expect(withAllowedRootsHint(message)).toContain('pass --allowed-roots <dir>')
  })

  it('leaves an unrelated resolver failure untouched', () => {
    const message = 'Refusing to resolve remote $ref (remote $ref resolution is disabled): https://example.test/s.json'

    expect(withAllowedRootsHint(message)).toBe(message)
  })
})
