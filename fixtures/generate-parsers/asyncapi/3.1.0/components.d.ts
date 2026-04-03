export type ComponentsObject = {
    /** An object to hold reusable Channel Bindings Objects. */
    channelBindings?: Record<string, unknown | unknown>;
    /** An object to hold reusable Channel Objects. */
    channels?: Record<string, unknown | unknown>;
    /** An object to hold reusable Correlation ID Objects. */
    correlationIds?: Record<string, unknown | unknown>;
    /** An object to hold reusable External Documentation Objects. */
    externalDocs?: Record<string, unknown | unknown>;
    /** An object to hold reusable Message Bindings Objects. */
    messageBindings?: Record<string, unknown | unknown>;
    /** An object to hold reusable Message Trait Objects. */
    messageTraits?: Record<string, unknown | unknown>;
    /** An object to hold reusable Message Objects. */
    messages?: Record<string, unknown | unknown>;
    /** An object to hold reusable Operation Bindings Objects. */
    operationBindings?: Record<string, unknown | unknown>;
    /** An object to hold reusable Operation Trait Objects. */
    operationTraits?: Record<string, unknown | unknown>;
    operations?: Record<string, unknown | unknown>;
    /** An object to hold reusable Parameter Objects. */
    parameters?: Record<string, unknown | unknown>;
    /** An object to hold reusable Operation Reply Objects. */
    replies?: Record<string, unknown | unknown>;
    /** An object to hold reusable Operation Reply Address Objects. */
    replyAddresses?: Record<string, unknown | unknown>;
    /** An object to hold reusable Schema Object. If this is a Schema Object, then the schemaFormat will be assumed to be 'application/vnd.aai.asyncapi+json;version=asyncapi' where the version is equal to the AsyncAPI Version String. */
    schemas?: Record<string, unknown>;
    /** An object to hold reusable Security Scheme Objects. */
    securitySchemes?: Record<string, unknown | unknown>;
    /** An object to hold reusable Server Bindings Objects. */
    serverBindings?: Record<string, unknown | unknown>;
    /** An object to hold reusable Server Variable Objects. */
    serverVariables?: Record<string, unknown | unknown>;
    /** An object to hold reusable Server Objects. */
    servers?: Record<string, unknown | unknown>;
    /** An object to hold reusable Tag Objects. */
    tags?: Record<string, unknown | unknown>;
};
