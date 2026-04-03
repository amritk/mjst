export type BindingsSqs020ChannelQueueObject = {
    /** The name of the queue. When an SNS Operation Binding Object references an SQS queue by name, the identifier should be the one in this field. */
    name: string;
    /** Is this a FIFO queue? */
    fifoQueue: boolean;
    /** Specifies whether message deduplication occurs at the message group or queue level. Valid values are messageGroup and queue (default). */
    deduplicationScope?: "queue" | "messageGroup";
    /** Specifies whether the FIFO queue throughput quota applies to the entire queue or per message group. Valid values are perQueue (default) and perMessageGroupId. */
    fifoThroughputLimit?: "perQueue" | "perMessageGroupId";
    /** The number of seconds to delay before a message sent to the queue can be received. used to create a delay queue. */
    deliveryDelay?: number;
    /** The length of time, in seconds, that a consumer locks a message - hiding it from reads - before it is unlocked and can be read again. */
    visibilityTimeout?: number;
    /** Determines if the queue uses short polling or long polling. Set to zero the queue reads available messages and returns immediately. Set to a non-zero integer, long polling waits the specified number of seconds for messages to arrive before returning. */
    receiveMessageWaitTime?: number;
    /** How long to retain a message on the queue in seconds, unless deleted. */
    messageRetentionPeriod?: number;
    redrivePolicy?: unknown;
    policy?: unknown;
    /** Key-value pairs that represent AWS tags on the queue. */
    tags?: object;
};
