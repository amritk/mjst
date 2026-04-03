export type AuthorizationCodeOAuthFlowObject = {
    authorizationUrl: string;
    tokenUrl: string;
    refreshUrl?: string;
    scopes: Record<string, string>;
};
