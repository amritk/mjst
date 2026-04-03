export type ChannelObject = {
    /** A human-friendly title for the channel. */
    title?: string;
    /** A longer description of the channel. CommonMark is allowed. */
    description?: string;
    /** An optional string representation of this channel's address. The address is typically the "topic name", "routing key", "event type", or "path". When `null` or absent, it MUST be interpreted as unknown. This is useful when the address is generated dynamically at runtime or can't be known upfront. It MAY contain Channel Address Expressions. */
    address?: string | null;
    bindings?: unknown | unknown;
    externalDocs?: unknown | unknown;
    messages?: unknown;
    parameters?: unknown;
    /** The references of the servers on which this channel is available. If absent or empty then this channel must be available on all servers. */
    servers?: unknown[];
    /** A brief summary of the channel. */
    summary?: string;
    /** A list of tags for logical grouping of channels. */
    tags?: (unknown | unknown)[];
};
