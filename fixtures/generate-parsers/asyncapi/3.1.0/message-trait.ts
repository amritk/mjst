export type MessageTraitObject = {
  /** A human-friendly title for the message. */
  title?: string;
  /** A longer description of the message. CommonMark is allowed. */
  description?: string;
  /** List of examples. */
  examples?: unknown[];
  deprecated?: boolean;
  bindings?: unknown | unknown;
  /** The content type to use when encoding/decoding a message's payload. The value MUST be a specific media type (e.g. application/json). When omitted, the value MUST be the one specified on the defaultContentType field. */
  contentType?: string;
  correlationId?: unknown | unknown;
  externalDocs?: unknown | unknown;
  headers?: unknown;
  /** Name of the message. */
  name?: string;
  /** A brief summary of the message. */
  summary?: string;
  tags?: (unknown | unknown)[];
};