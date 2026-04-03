export type BindingsIbmmqServerObject = {
  /** Defines a logical group of IBM MQ server objects. This is necessary to specify multi-endpoint configurations used in high availability deployments. If omitted, the server object is not part of a group. */
  groupId?: string;
  /** The name of the IBM MQ queue manager to bind to in the CCDT file. */
  ccdtQueueManagerName?: string;
  /** The recommended cipher specification used to establish a TLS connection between the client and the IBM MQ queue manager. More information on SSL/TLS cipher specifications supported by IBM MQ can be found on this page in the IBM MQ Knowledge Center. */
  cipherSpec?: string;
  /** If 'multiEndpointServer' is 'true' then multiple connections can be workload balanced and applications should not make assumptions as to where messages are processed. Where message ordering, or affinity to specific message resources is necessary, a single endpoint ('multiEndpointServer' = 'false') may be required. */
  multiEndpointServer?: boolean;
  /** The recommended value (in seconds) for the heartbeat sent to the queue manager during periods of inactivity. A value of zero means that no heart beats are sent. A value of 1 means that the client will use the value defined by the queue manager. More information on heart beat interval can be found on this page in the IBM MQ Knowledge Center. */
  heartBeatInterval?: number;
  /** The version of this binding. */
  bindingVersion?: "0.1.0";
};