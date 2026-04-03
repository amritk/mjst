export type PasswordOAuthFlowObject = {
    tokenUrl: string;
    refreshUrl?: string;
    scopes: Record<string, string>;
};
