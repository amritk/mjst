export type BindingsSqsOperationObject = {
  /** Queue objects that are either the endpoint for an SNS Operation Binding Object, or the deadLetterQueue of the SQS Operation Binding Object. */
  queues: unknown[];
  /** The version of this binding. If omitted, 'latest' MUST be assumed. */
  bindingVersion?: "0.1.0" | "0.2.0";
};