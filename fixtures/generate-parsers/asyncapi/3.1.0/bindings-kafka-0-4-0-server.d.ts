export type BindingsKafka040ServerObject = {
    /** API URL for the Schema Registry used when producing Kafka messages (if a Schema Registry was used). */
    schemaRegistryUrl?: string;
    /** The vendor of the Schema Registry and Kafka serdes library that should be used. */
    schemaRegistryVendor?: string;
    /** The version of this binding. */
    bindingVersion?: "0.4.0";
};
