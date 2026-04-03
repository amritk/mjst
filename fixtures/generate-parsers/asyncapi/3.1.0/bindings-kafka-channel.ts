export type BindingsKafkaChannelObject = {
  /** Kafka topic name if different from channel name. */
  topic?: string;
  /** Number of partitions configured on this topic. */
  partitions?: number;
  /** Number of replicas configured on this topic. */
  replicas?: number;
  /** The version of this binding. If omitted, 'latest' MUST be assumed. */
  bindingVersion?: "0.3.0";
};