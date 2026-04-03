export type BindingsAmqp030OperationObject = {
    /** TTL (Time-To-Live) for the message. It MUST be greater than or equal to zero. */
    expiration?: number;
    /** Identifies the user who has sent the message. */
    userId?: string;
    /** The routing keys the message should be routed to at the time of publishing. */
    cc?: string[];
    /** A priority for the message. */
    priority?: number;
    /** Delivery mode of the message. Its value MUST be either 1 (transient) or 2 (persistent). */
    deliveryMode?: 1 | 2;
    /** Whether the message is mandatory or not. */
    mandatory?: boolean;
    /** Like cc but consumers will not receive this information. */
    bcc?: string[];
    /** Whether the message should include a timestamp or not. */
    timestamp?: boolean;
    /** Whether the consumer should ack the message or not. */
    ack?: boolean;
    /** The version of this binding. If omitted, "latest" MUST be assumed. */
    bindingVersion?: "0.3.0";
};
