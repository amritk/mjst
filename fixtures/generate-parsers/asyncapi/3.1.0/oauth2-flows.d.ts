export type Oauth2FlowsObject = {
    /** A short description for security scheme. */
    description?: string;
    /** The type of the security scheme. */
    type: "oauth2";
    flows: {
        authorizationCode?: unknown & unknown;
        clientCredentials?: unknown & unknown & unknown;
        implicit?: unknown & unknown & unknown;
        password?: unknown & unknown & unknown;
    };
    /** List of the needed scope names. */
    scopes?: string[];
};
