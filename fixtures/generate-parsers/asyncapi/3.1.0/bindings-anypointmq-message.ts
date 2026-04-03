export type BindingsAnypointmqMessageObject = {
  /** A Schema object containing the definitions for Anypoint MQ-specific headers (protocol headers). This schema MUST be of type 'object' and have a 'properties' key. Examples of Anypoint MQ protocol headers are 'messageId' and 'messageGroupId'. */
  headers?: unknown | unknown;
  /** The version of this binding. If omitted, 'latest' MUST be assumed. */
  bindingVersion?: "0.0.1";
};