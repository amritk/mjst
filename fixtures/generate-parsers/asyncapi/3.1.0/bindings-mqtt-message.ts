export type BindingsMqttMessageObject = {
  /** 1 indicates that the payload is UTF-8 encoded character data.  0 indicates that the payload format is unspecified. */
  payloadFormatIndicator?: 0 | 1;
  /** Correlation Data is used by the sender of the request message to identify which request the response message is for when it is received. */
  correlationData?: unknown | unknown;
  /** String describing the content type of the message payload. This should not conflict with the contentType field of the associated AsyncAPI Message object. */
  contentType?: string;
  /** The topic (channel URI) to be used for a response message. */
  responseTopic?: string | unknown | unknown;
  /** The version of this binding. If omitted, 'latest' MUST be assumed. */
  bindingVersion?: "0.2.0";
};