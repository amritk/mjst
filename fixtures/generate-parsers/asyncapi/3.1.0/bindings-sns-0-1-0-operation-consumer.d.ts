export type BindingsSns010OperationConsumerObject = {
    /** The protocol that this endpoint receives messages by. */
    protocol: "http" | "https" | "email" | "email-json" | "sms" | "sqs" | "application" | "lambda" | "firehose";
    /** The endpoint messages are delivered to. */
    endpoint: unknown;
    /** Only receive a subset of messages from the channel, determined by this policy. Depending on the FilterPolicyScope, a map of either a message attribute or message body to an array of possible matches. The match may be a simple string for an exact match, but it may also be an object that represents a constraint and values for that constraint. */
    filterPolicy?: Record<string, string[] | string | object>;
    /** Determines whether the FilterPolicy applies to MessageAttributes or MessageBody. */
    filterPolicyScope?: "MessageAttributes" | "MessageBody";
    /** If true AWS SNS attributes are removed from the body, and for SQS, SNS message attributes are copied to SQS message attributes. If false the SNS attributes are included in the body. */
    rawMessageDelivery: boolean;
    redrivePolicy?: unknown;
    /** Policy for retries to HTTP. The parameter is for that SNS Subscription and overrides any policy on the SNS Topic. */
    deliveryPolicy?: unknown;
    /** The display name to use with an SNS subscription */
    displayName?: string;
};
