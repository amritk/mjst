export type BindingsKafka040ChannelObject = {
    /** Kafka topic name if different from channel name. */
    topic?: string;
    /** Number of partitions configured on this topic. */
    partitions?: number;
    /** Number of replicas configured on this topic. */
    replicas?: number;
    /** Topic configuration properties that are relevant for the API. */
    topicConfiguration?: {
        'cleanup.policy'?: ("compact" | "delete")[];
        'retention.ms'?: number;
        'retention.bytes'?: number;
        'delete.retention.ms'?: number;
        'max.message.bytes'?: number;
    };
    /** The version of this binding. If omitted, 'latest' MUST be assumed. */
    bindingVersion?: "0.4.0";
};
