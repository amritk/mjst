export type BindingsSns010OperationRedrivePolicyObject = {
    /** The SQS queue to use as a dead letter queue (DLQ). */
    deadLetterQueue: unknown;
    /** The number of times a message is delivered to the source queue before being moved to the dead-letter queue. */
    maxReceiveCount?: number;
};
