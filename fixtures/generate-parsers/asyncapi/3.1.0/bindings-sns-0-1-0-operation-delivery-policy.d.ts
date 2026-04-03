export type BindingsSns010OperationDeliveryPolicyObject = {
    /** The minimum delay for a retry in seconds. */
    minDelayTarget?: number;
    /** The maximum delay for a retry in seconds. */
    maxDelayTarget?: number;
    /** The total number of retries, including immediate, pre-backoff, backoff, and post-backoff retries. */
    numRetries?: number;
    /** The number of immediate retries (with no delay). */
    numNoDelayRetries?: number;
    /** The number of immediate retries (with delay). */
    numMinDelayRetries?: number;
    /** The number of post-backoff phase retries, with the maximum delay between retries. */
    numMaxDelayRetries?: number;
    /** The algorithm for backoff between retries. */
    backoffFunction?: "arithmetic" | "exponential" | "geometric" | "linear";
    /** The maximum number of deliveries per second, per subscription. */
    maxReceivesPerSecond?: number;
};
