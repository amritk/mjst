export type BindingsSolace040ServerObject = {
    /** The name of the Virtual Private Network to connect to on the Solace broker. */
    msgVpn?: string;
    /** A unique client name to use to register to the appliance. If specified, it must be a valid Topic name, and a maximum of 160 bytes in length when encoded as UTF-8. */
    clientName?: string;
    /** The version of this binding. */
    bindingVersion?: "0.4.0";
};
