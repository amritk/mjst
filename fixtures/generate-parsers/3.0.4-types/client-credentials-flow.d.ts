export type ClientCredentialsFlowObject = {
    tokenUrl: string;
    refreshUrl?: string;
    scopes: Record<string, string>;
};
