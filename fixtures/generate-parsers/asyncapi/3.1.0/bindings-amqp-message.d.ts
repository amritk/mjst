export type BindingsAmqpMessageObject = {
    /** A MIME encoding for the message content. */
    contentEncoding?: string;
    /** Application-specific message type. */
    messageType?: string;
    /** The version of this binding. If omitted, "latest" MUST be assumed. */
    bindingVersion?: "0.3.0";
};
