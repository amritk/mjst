export type BindingsRos2OperationObject = {
    /** The version of this binding. If omitted, 'latest' MUST be assumed. */
    bindingVersion?: "0.1.0";
    /** The name of the ROS 2 node that implements this operation. */
    node: string;
    qosPolicies?: {
        deadline?: number;
        durability?: "transient_local" | "volatile";
        history?: "keep_last" | "keep_all" | "unknown";
        leaseDuration?: number;
        lifespan?: number;
        liveliness?: "automatic" | "manual";
        reliability?: "best_effort" | "realiable";
    };
    /** Specifies the ROS 2 type of the node for this operation. */
    role: "publisher" | "action_client" | "service_client" | "subscriber" | "action_server" | "service_server";
};
