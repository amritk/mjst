export type BindingsSns010ChannelOrderingObject = {
    /** Defines the type of SNS Topic. */
    type: "standard" | "FIFO";
    /** True to turn on de-duplication of messages for a channel. */
    contentBasedDeduplication?: boolean;
};
