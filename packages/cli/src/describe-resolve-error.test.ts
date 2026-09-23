import { describe, expect, it } from 'vitest'

import { describeResolveError } from './describe-resolve-error'

describe('describe-resolve-error', () => {
  // `@amritk/resolve-refs` records a failed load as `String(err)`, which puts
  // the error's class name in front of every message.
  it('drops the leading "Error: " a stringified error carries', () => {
    expect(describeResolveError("Error: ENOENT: no such file or directory, open '/specs/nope.yaml'")).toBe(
      "ENOENT: no such file or directory, open '/specs/nope.yaml'",
    )
  })

  it('keeps a message that does not start with the prefix as it is', () => {
    expect(describeResolveError('Cannot resolve $ref "#/components/schemas/Missing"')).toBe(
      'Cannot resolve $ref "#/components/schemas/Missing"',
    )
    // Only the leading class name is noise; one quoted further in is part of the detail.
    expect(describeResolveError('Failed to fetch https://x.test/a.json: Error: timed out')).toBe(
      'Failed to fetch https://x.test/a.json: Error: timed out',
    )
  })

  it('still names the CLI flag on a confinement refusal', () => {
    expect(
      describeResolveError(
        'Error: Refusing to read local $ref (it resolves outside the allowed roots [/specs/v1] (set allowedRoots to permit it)): /specs/common/user.json',
      ),
    ).toMatch(/^Refusing to read local \$ref .* pass --allowed-roots <dir>/)
  })
})
