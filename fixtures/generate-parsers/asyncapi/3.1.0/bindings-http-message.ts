export type BindingsHttpMessageObject = {
  /** 	A Schema object containing the definitions for HTTP-specific headers. This schema MUST be of type 'object' and have a 'properties' key. */
  headers?: unknown;
  /** The version of this binding. If omitted, "latest" MUST be assumed. */
  bindingVersion?: "0.2.0";
};