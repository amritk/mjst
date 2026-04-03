export type BindingsSnsOperationObject = {
    /** Often we can assume that the SNS Topic is the channel name-we provide this field in case the you need to supply the ARN, or the Topic name is not the channel name in the AsyncAPI document. */
    topic?: unknown;
    /** The protocols that listen to this topic and their endpoints. */
    consumers: unknown[];
    /** Policy for retries to HTTP. The field is the default for HTTP receivers of the SNS Topic which may be overridden by a specific consumer. */
    deliveryPolicy?: unknown;
    /** The version of this binding. */
    bindingVersion?: string;
};
