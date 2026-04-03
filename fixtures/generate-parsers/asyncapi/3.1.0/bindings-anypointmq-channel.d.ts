export type BindingsAnypointmqChannelObject = {
    /** The destination (queue or exchange) name for this channel. SHOULD only be specified if the channel name differs from the actual destination name, such as when the channel name is not a valid destination name in Anypoint MQ. Defaults to the channel name. */
    destination?: string;
    /** The type of destination. SHOULD be specified to document the messaging model (publish/subscribe, point-to-point, strict message ordering) supported by this channel. */
    destinationType?: "exchange" | "queue" | "fifo-queue";
    /** The version of this binding. If omitted, 'latest' MUST be assumed. */
    bindingVersion?: "0.0.1";
};
