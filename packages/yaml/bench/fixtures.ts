/**
 * Benchmark fixtures. We keep them self-contained (no reliance on external spec
 * files) so `bun run bench` works from a fresh checkout, while still covering
 * the shapes that matter: a tiny config, a realistic OpenAPI-ish document, and
 * a large document built by repetition to amortize per-call overhead.
 */

const SMALL = `openapi: 3.1.0
info:
  title: Tiny API
  version: 1.0.0
  description: A small configuration document.
servers:
  - url: https://api.example.com
paths: {}
`

const MEDIUM = `openapi: 3.1.0
info:
  title: Museum API
  description: |
    A delightful imaginary museum API.

    Built to exercise block scalars, flow collections, and nesting.
  version: 1.2.1
  contact:
    email: team@example.com
    url: "https://example.com/docs"
servers:
  - url: "https://example.com/api"
    description: Production
tags:
  - name: Operations
  - name: Events
paths:
  /museum-hours:
    get:
      summary: Get museum hours
      operationId: getMuseumHours
      tags: [Operations]
      parameters:
        - name: startDate
          in: query
          required: false
          schema: { type: string, format: date }
        - name: page
          in: query
          schema: { type: integer, minimum: 1, default: 1 }
      responses:
        "200":
          description: Success.
          content:
            application/json:
              schema:
                type: object
                properties:
                  date: { type: string, format: date }
                  hours: { type: string }
                required: [date, hours]
        "400":
          description: Bad request.
        "404":
          description: Not found.
  /special-events:
    post:
      summary: Create special events
      operationId: createSpecialEvent
      tags: [Events]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                name: { type: string }
                location: { type: string }
                eventDescription: { type: string }
                dates:
                  type: array
                  items: { type: string, format: date }
                price: { type: number, format: float }
              required: [name, location, dates]
      responses:
        "201":
          description: Created.
components:
  schemas:
    Error:
      type: object
      properties:
        type: { type: string }
        title: { type: string }
        detail: { type: string }
`

/** Repeats a path block to produce a large document with realistic structure. */
const buildLarge = (): string => {
  const header = `openapi: 3.1.0
info:
  title: Large API
  version: 3.0.0
paths:
`
  const blocks: string[] = []
  for (let i = 0; i < 120; i++) {
    blocks.push(`  /resource-${i}:
    get:
      summary: Get resource ${i}
      operationId: getResource${i}
      tags: [resource]
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      responses:
        "200":
          description: |
            Returns resource ${i}.
            See the docs for the full schema.
          content:
            application/json:
              schema:
                type: object
                properties:
                  id: { type: string }
                  name: { type: string }
                  count: { type: integer }
                  active: { type: boolean }
                  ratio: { type: number }
                  tags:
                    type: array
                    items: { type: string }
        "404":
          description: Resource ${i} not found.
`)
  }
  return header + blocks.join('')
}

export const FIXTURES = {
  small: SMALL,
  medium: MEDIUM,
  large: buildLarge(),
} as const
