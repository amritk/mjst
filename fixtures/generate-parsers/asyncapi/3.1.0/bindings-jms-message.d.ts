export type BindingsJmsMessageObject = {
    /** A Schema object containing the definitions for JMS headers (protocol headers). This schema MUST be of type 'object' and have a 'properties' key. Examples of JMS protocol headers are 'JMSMessageID', 'JMSTimestamp', and 'JMSCorrelationID'. */
    headers?: unknown;
    /** The version of this binding. If omitted, 'latest' MUST be assumed. */
    bindingVersion?: "0.0.1";
};
