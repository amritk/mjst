export type ImplicitOAuthFlowObject = {
    authorizationUrl: string;
    refreshUrl?: string;
    scopes: Record<string, string>;
};
