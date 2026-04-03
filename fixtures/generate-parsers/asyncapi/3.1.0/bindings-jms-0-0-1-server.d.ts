export type BindingsJms001ServerObject = {
    /** The classname of the ConnectionFactory implementation for the JMS Provider. */
    jmsConnectionFactory: string;
    /** Additional properties to set on the JMS ConnectionFactory implementation for the JMS Provider. */
    properties?: unknown[];
    /** A client identifier for applications that use this JMS connection factory. If the Client ID Policy is set to 'Restricted' (the default), then configuring a Client ID on the ConnectionFactory prevents more than one JMS client from using a connection from this factory. */
    clientID?: string;
    /** The version of this binding. If omitted, 'latest' MUST be assumed. */
    bindingVersion?: "0.0.1";
};
