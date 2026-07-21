/**
 * `@amritk/mini/forms` — field state (value, dirty, touched, errors) as signals,
 * submit handling, and validation, for the dashboards' forms. Every input wires
 * up through the core `bindValue`, and validation accepts either a plain
 * `(values) => errors` function or a JSON Schema run through
 * `@amritk/runtime-validators`, so a form can dogfood the mjst validation stack
 * and stay eval-free/CSP-safe.
 *
 * It is its own module graph — the widget's `.` bundle gains nothing from its
 * existence. The schema arm imports `@amritk/runtime-validators`, an optional
 * peer: install it only if you validate with schemas.
 */
export type { Field, FieldValues, Form, FormConfig, FormValidate } from './create-form'
export { createForm } from './create-form'
export type { FormErrors } from './schema-to-validator'
export { schemaToValidator } from './schema-to-validator'
