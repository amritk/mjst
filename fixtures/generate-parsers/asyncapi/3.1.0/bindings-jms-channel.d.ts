export type BindingsJmsChannelObject = {
    /** The destination (queue) name for this channel. SHOULD only be specified if the channel name differs from the actual destination name, such as when the channel name is not a valid destination name according to the JMS Provider. Defaults to the channel name. */
    destination?: string;
    /** The type of destination. SHOULD be specified to document the messaging model (point-to-point, or strict message ordering) supported by this channel. */
    destinationType?: "queue" | "fifo-queue";
    /** The version of this binding. If omitted, 'latest' MUST be assumed. */
    bindingVersion?: "0.0.1";
};
