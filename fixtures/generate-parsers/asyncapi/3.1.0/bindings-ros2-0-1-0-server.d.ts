export type BindingsRos2010ServerObject = {
    /** The version of this binding. If omitted, 'latest' MUST be assumed. */
    bindingVersion?: "0.1.0";
    /** All ROS 2 nodes use domain ID 0 by default. To prevent interference between different groups of computers running ROS 2 on the same network, a group can be set with a unique domain ID. */
    domainId?: number;
    /** Specifies the ROS 2 middleware implementation to be used. This determines the underlying middleware implementation that handles communication. */
    rmwImplementation?: string;
};
