export type OperationReplyObject = {
    address?: unknown | unknown;
    channel?: unknown;
    /** A list of $ref pointers pointing to the supported Message Objects that can be processed by this operation as reply. It MUST contain a subset of the messages defined in the channel referenced in this operation reply. Every message processed by this operation MUST be valid against one, and only one, of the message objects referenced in this list. Please note the messages property value MUST be a list of Reference Objects and, therefore, MUST NOT contain Message Objects. However, it is RECOMMENDED that parsers (or other software) dereference this property for a better development experience. */
    messages?: unknown[];
};
