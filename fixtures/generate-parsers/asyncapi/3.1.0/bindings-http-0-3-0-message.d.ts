export type BindingsHttp030MessageObject = {
    /** 	A Schema object containing the definitions for HTTP-specific headers. This schema MUST be of type 'object' and have a 'properties' key. */
    headers?: unknown;
    /** The HTTP response status code according to [RFC 9110](https://httpwg.org/specs/rfc9110.html#overview.of.status.codes). `statusCode` is only relevant for messages referenced by the [Operation Reply Object](https://www.asyncapi.com/docs/reference/specification/v3.0.0#operationReplyObject), as it defines the status code for the response. In all other cases, this value can be safely ignored. */
    statusCode?: number;
    /** The version of this binding. If omitted, "latest" MUST be assumed. */
    bindingVersion?: "0.3.0";
};
