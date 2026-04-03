export type Document = {
    /** A unique id representing the application. */
    id?: string;
    /** The AsyncAPI specification version of this document. */
    asyncapi: "3.1.0";
    channels?: unknown;
    components?: unknown;
    /** Default content type to use when encoding/decoding a message's payload. */
    defaultContentType?: string;
    info: unknown;
    operations?: unknown;
    servers?: unknown;
};
