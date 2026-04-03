export type OperationReplyAddressObject = {
    /** An optional description of the address. CommonMark is allowed. */
    description?: string;
    /** A runtime expression that specifies the location of the reply address. */
    location: string;
};
