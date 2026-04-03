export type OperationTraitObject = {
  /** A human-friendly title for the operation. */
  title?: unknown;
  /** A verbose explanation of the operation. CommonMark syntax can be used for rich text representation. */
  description?: unknown;
  /** A map where the keys describe the name of the protocol and the values describe protocol-specific definitions for the operation. */
  bindings?: unknown | unknown;
  /** Additional external documentation for this operation. */
  externalDocs?: unknown;
  /** A declaration of which security schemes are associated with this operation. Only one of the security scheme objects MUST be satisfied to authorize an operation. In cases where Server Security also applies, it MUST also be satisfied. */
  security?: unknown;
  /** A short summary of what the operation is about. */
  summary?: unknown;
  /** A list of tags for logical grouping and categorization of operations. */
  tags?: unknown;
};