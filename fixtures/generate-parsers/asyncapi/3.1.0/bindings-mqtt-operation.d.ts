export type BindingsMqttOperationObject = {
    /** Defines the Quality of Service (QoS) levels for the message flow between client and server. Its value MUST be either 0 (At most once delivery), 1 (At least once delivery), or 2 (Exactly once delivery). */
    qos?: 0 | 1 | 2;
    /** Whether the broker should retain the message or not. */
    retain?: boolean;
    /** Lifetime of the message in seconds */
    messageExpiryInterval?: number | unknown | unknown;
    /** The version of this binding. If omitted, 'latest' MUST be assumed. */
    bindingVersion?: "0.2.0";
};
