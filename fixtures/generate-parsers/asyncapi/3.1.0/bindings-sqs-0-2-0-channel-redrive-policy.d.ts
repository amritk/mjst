export type BindingsSqs020ChannelRedrivePolicyObject = {
    deadLetterQueue: unknown;
    /** The number of times a message is delivered to the source queue before being moved to the dead-letter queue. */
    maxReceiveCount?: number;
};
