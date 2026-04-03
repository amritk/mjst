export type BindingsGooglepubsub020ChannelObject = {
    /** The version of this binding. */
    bindingVersion?: "0.2.0";
    labels?: object;
    messageRetentionDuration?: string;
    messageStoragePolicy?: {
        allowedPersistenceRegions?: string[];
    };
    schemaSettings: {
        encoding: string;
        firstRevisionId?: string;
        lastRevisionId?: string;
        name: string;
    };
};
