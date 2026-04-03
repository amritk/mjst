export type BindingsPulsarChannelObject = {
    /** The namespace, the channel is associated with. */
    namespace: string;
    /** persistence of the topic in Pulsar. */
    persistence: "persistent" | "non-persistent";
    /** Topic compaction threshold given in MB */
    compaction?: number;
    /** A list of clusters the topic is replicated to. */
    'geo-replication'?: string[];
    retention?: {
        time?: number;
        size?: number;
    };
    /** TTL in seconds for the specified topic */
    ttl?: number;
    /** Whether deduplication of events is enabled or not. */
    deduplication?: boolean;
    /** The version of this binding. If omitted, 'latest' MUST be assumed. */
    bindingVersion?: "0.1.0";
};
