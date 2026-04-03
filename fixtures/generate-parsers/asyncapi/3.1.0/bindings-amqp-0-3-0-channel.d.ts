export type BindingsAmqp030ChannelObject = {
    /** Defines what type of channel is it. Can be either 'queue' or 'routingKey' (default). */
    is?: "queue" | "routingKey";
    /** When is=routingKey, this object defines the exchange properties. */
    exchange?: {
        name?: string;
        type?: "topic" | "direct" | "fanout" | "default" | "headers";
        durable?: boolean;
        autoDelete?: boolean;
        vhost?: string;
    };
    /** When is=queue, this object defines the queue properties. */
    queue?: {
        name?: string;
        durable?: boolean;
        exclusive?: boolean;
        autoDelete?: boolean;
        vhost?: string;
    };
    /** The version of this binding. If omitted, 'latest' MUST be assumed. */
    bindingVersion?: "0.3.0";
};
