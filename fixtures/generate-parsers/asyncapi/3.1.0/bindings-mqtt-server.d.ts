export type BindingsMqttServerObject = {
    /** The client identifier. */
    clientId?: string;
    /** Whether to create a persistent connection or not. When 'false', the connection will be persistent. This is called clean start in MQTTv5. */
    cleanSession?: boolean;
    /** Last Will and Testament configuration. */
    lastWill?: {
        topic?: string;
        qos?: 0 | 1 | 2;
        message?: string;
        retain?: boolean;
    };
    /** Interval in seconds of the longest period of time the broker and the client can endure without sending a message. */
    keepAlive?: number;
    /** Interval time in seconds or a Schema Object containing the definition of the interval.  The broker maintains a session for a disconnected client until this interval expires. */
    sessionExpiryInterval?: number | unknown | unknown;
    /** Number of bytes or a Schema Object representing the Maximum Packet Size the Client is willing to accept. */
    maximumPacketSize?: number | unknown | unknown;
    /** The version of this binding. If omitted, 'latest' MUST be assumed. */
    bindingVersion?: "0.2.0";
};
