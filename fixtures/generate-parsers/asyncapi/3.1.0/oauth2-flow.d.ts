export type Oauth2FlowObject = {
    /** The authorization URL to be used for this flow. This MUST be in the form of an absolute URL. */
    authorizationUrl?: string;
    /** The available scopes for the OAuth2 security scheme. A map between the scope name and a short description for it. */
    availableScopes?: unknown;
    /** The URL to be used for obtaining refresh tokens. This MUST be in the form of an absolute URL. */
    refreshUrl?: string;
    /** The token URL to be used for this flow. This MUST be in the form of an absolute URL. */
    tokenUrl?: string;
};
