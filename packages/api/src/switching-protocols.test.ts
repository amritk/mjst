import { describe, expect, it } from 'vitest'

import { switchingProtocols } from './switching-protocols'

/** Whether this runtime's `Response` constructor accepts the handshake status. */
const accepts101 = (): boolean => {
  try {
    return new Response(null, { status: 101 }).status === 101
  } catch {
    return false
  }
}

describe('switching-protocols', () => {
  it('reports 101 wherever the runtime allows it, and stays constructible where it does not', () => {
    // Node's undici enforces the Fetch spec's 200-599 range and throws; Bun and
    // workerd both accept 101. Either way the helper has to return a Response,
    // because a throw here would surface as the pipeline's 500 on a handshake
    // that actually succeeded.
    const response = switchingProtocols()
    expect(response).toBeInstanceOf(Response)
    expect(response.status).toBe(accepts101() ? 101 : 200)
  })

  it('carries a null body, since a handshake has none', () => {
    expect(switchingProtocols().body).toBeNull()
  })

  it('merges the workerd-only webSocket field without disturbing the status', () => {
    const socket = { marker: true }
    const response = switchingProtocols({ webSocket: socket })
    expect(response.status).toBe(accepts101() ? 101 : 200)
  })
})
