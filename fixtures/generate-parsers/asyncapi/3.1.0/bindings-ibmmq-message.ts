export type BindingsIbmmqMessageObject = {
  /** The type of the message. */
  type?: "string" | "jms" | "binary";
  /** Defines the IBM MQ message headers to include with this message. More than one header can be specified as a comma separated list. Supporting information on IBM MQ message formats can be found on this [page](https://www.ibm.com/docs/en/ibm-mq/9.2?topic=mqmd-format-mqchar8) in the IBM MQ Knowledge Center. */
  headers?: string;
  /** Provides additional information for application developers: describes the message type or format. */
  description?: string;
  /** The recommended setting the client should use for the TTL (Time-To-Live) of the message. This is a period of time expressed in milliseconds and set by the application that puts the message. 'expiry' values are API dependant e.g., MQI and JMS use different units of time and default values for 'unlimited'. General information on IBM MQ message expiry can be found on this [page](https://www.ibm.com/docs/en/ibm-mq/9.2?topic=mqmd-expiry-mqlong) in the IBM MQ Knowledge Center. */
  expiry?: number;
  /** The version of this binding. */
  bindingVersion?: "0.1.0";
};