export type BindingsHttpOperationObject = {
  /** When 'type' is 'request', this is the HTTP method, otherwise it MUST be ignored. Its value MUST be one of 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', and 'TRACE'. */
  method?: "GET" | "PUT" | "POST" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "CONNECT" | "TRACE";
  /** A Schema object containing the definitions for each query parameter. This schema MUST be of type 'object' and have a properties key. */
  query?: unknown;
  /** The version of this binding. If omitted, 'latest' MUST be assumed. */
  bindingVersion?: "0.2.0";
};