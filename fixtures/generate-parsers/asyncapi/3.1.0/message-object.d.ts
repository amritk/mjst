export type MessageObjectObject = {
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
    payload?: unknown;
    /** A brief summary of the message. */
    summary?: string;
    tags?: (unknown | unknown)[];
    /** A list of traits to apply to the message object. Traits MUST be merged using traits merge mechanism. The resulting object MUST be a valid Message Object. */
    traits?: (unknown | unknown | unknown[])[];
};
