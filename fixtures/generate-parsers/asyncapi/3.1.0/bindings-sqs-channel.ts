export type BindingsSqsChannelObject = {
  /** A definition of the queue that will be used as the channel. */
  queue: unknown;
  /** A definition of the queue that will be used for un-processable messages. */
  deadLetterQueue?: unknown;
  /** The version of this binding. If omitted, 'latest' MUST be assumed. */
  bindingVersion?: "0.1.0" | "0.2.0";
};