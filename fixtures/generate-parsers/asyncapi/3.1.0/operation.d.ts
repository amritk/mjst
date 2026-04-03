export type OperationObject = {
    /** A human-friendly title for the operation. */
    title?: string;
    /** A longer description of the operation. CommonMark is allowed. */
    description?: string;
    /** Allowed values are send and receive. Use send when it's expected that the application will send a message to the given channel, and receive when the application should expect receiving messages from the given channel. */
    action: "send" | "receive";
    bindings?: unknown | unknown;
    channel: unknown;
    externalDocs?: unknown | unknown;
    /** A list of $ref pointers pointing to the supported Message Objects that can be processed by this operation. It MUST contain a subset of the messages defined in the channel referenced in this operation. Every message processed by this operation MUST be valid against one, and only one, of the message objects referenced in this list. Please note the messages property value MUST be a list of Reference Objects and, therefore, MUST NOT contain Message Objects. However, it is RECOMMENDED that parsers (or other software) dereference this property for a better development experience. */
    messages?: unknown[];
    reply?: unknown | unknown;
    security?: unknown;
    /** A brief summary of the operation. */
    summary?: string;
    /** A list of tags for logical grouping and categorization of operations. */
    tags?: (unknown | unknown)[];
    /** A list of traits to apply to the operation object. Traits MUST be merged using traits merge mechanism. The resulting object MUST be a valid Operation Object. */
    traits?: (unknown | unknown)[];
};
