export type BindingsKafka040MessageObject = {
    /** The message key. */
    key?: unknown | unknown | unknown;
    /** If a Schema Registry is used when performing this operation, tells where the id of schema is stored. */
    schemaIdLocation?: "header" | "payload";
    /** Number of bytes or vendor specific values when schema id is encoded in payload. */
    schemaIdPayloadEncoding?: string;
    /** Freeform string for any naming strategy class to use. Clients should default to the vendor default if not supplied. */
    schemaLookupStrategy?: string;
    /** The version of this binding. If omitted, 'latest' MUST be assumed. */
    bindingVersion?: "0.4.0";
};
