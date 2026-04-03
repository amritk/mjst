export type BindingsWebsocketsChannelObject = {
    /** The HTTP method to use when establishing the connection. Its value MUST be either 'GET' or 'POST'. */
    method?: "GET" | "POST";
    /** A Schema object containing the definitions for each query parameter. This schema MUST be of type 'object' and have a 'properties' key. */
    query?: unknown | unknown;
    /** A Schema object containing the definitions of the HTTP headers to use when establishing the connection. This schema MUST be of type 'object' and have a 'properties' key. */
    headers?: unknown | unknown;
    /** The version of this binding. If omitted, 'latest' MUST be assumed. */
    bindingVersion?: "0.1.0";
};
