export type BindingsIbmmqChannelObject = {
  /** Defines the type of AsyncAPI channel. */
  destinationType?: "topic" | "queue";
  /** Defines the properties of a queue. */
  queue?: { objectName: string; isPartitioned?: boolean; exclusive?: boolean };
  /** Defines the properties of a topic. */
  topic?: { string?: string; objectName?: string; durablePermitted?: boolean; lastMsgRetained?: boolean };
  /** The maximum length of the physical message (in bytes) accepted by the Topic or Queue. Messages produced that are greater in size than this value may fail to be delivered. More information on the maximum message length can be found on this [page](https://www.ibm.com/support/knowledgecenter/SSFKSJ_latest/com.ibm.mq.ref.dev.doc/q097520_.html) in the IBM MQ Knowledge Center. */
  maxMsgLength?: number;
  /** The version of this binding. */
  bindingVersion?: "0.1.0";
};