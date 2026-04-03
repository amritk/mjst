export type BindingsSns010ChannelObject = {
    /** The name of the topic. Can be different from the channel name to allow flexibility around AWS resource naming limitations. */
    name: string;
    ordering?: unknown;
    policy?: unknown;
    /** Key-value pairs that represent AWS tags on the topic. */
    tags?: object;
    /** The version of this binding. */
    bindingVersion?: string;
};
