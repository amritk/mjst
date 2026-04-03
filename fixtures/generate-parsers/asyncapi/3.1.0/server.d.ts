export type ServerObject = {
    /** A human-friendly title for the server. */
    title?: string;
    /** A longer description of the server. CommonMark is allowed. */
    description?: string;
    bindings?: unknown | unknown;
    externalDocs?: unknown | unknown;
    /** The server host name. It MAY include the port. This field supports Server Variables. Variable substitutions will be made when a variable is named in {braces}. */
    host: string;
    /** The path to a resource in the host. This field supports Server Variables. Variable substitutions will be made when a variable is named in {braces}. */
    pathname?: string;
    /** The protocol this server supports for connection. */
    protocol: string;
    /** An optional string describing the server. CommonMark syntax MAY be used for rich text representation. */
    protocolVersion?: string;
    security?: unknown;
    /** A brief summary of the server. */
    summary?: string;
    tags?: (unknown | unknown)[];
    variables?: unknown;
};
