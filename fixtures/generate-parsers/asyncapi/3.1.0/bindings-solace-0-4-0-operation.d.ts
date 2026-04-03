export type BindingsSolace040OperationObject = {
    /** The version of this binding. If omitted, "latest" MUST be assumed. */
    bindingVersion?: "0.4.0";
    /** The list of Solace destinations referenced in the operation. */
    destinations?: (unknown | unknown)[];
    /** Interval in milliseconds or a Schema Object containing the definition of the lifetime of the message. */
    timeToLive?: number;
    /** The valid priority value range is 0-255 with 0 as the lowest priority and 255 as the highest or a Schema Object containing the definition of the priority. */
    priority?: number;
    /** Set the message to be eligible to be moved to a Dead Message Queue. The default value is false. */
    dmqEligible?: boolean;
};
