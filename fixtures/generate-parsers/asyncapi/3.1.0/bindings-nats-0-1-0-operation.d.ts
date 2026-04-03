export type BindingsNats010OperationObject = {
    /** Defines the name of the queue to use. It MUST NOT exceed 255 characters. */
    queue?: string;
    /** The version of this binding. If omitted, 'latest' MUST be assumed. */
    bindingVersion?: "0.1.0";
};
