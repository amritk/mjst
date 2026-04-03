export type OpenIdConnectObject = {
    /** A short description for security scheme. CommonMark syntax MAY be used for rich text representation. */
    description?: string;
    /** The type of the security scheme. */
    type: "openIdConnect";
    /** OpenId Connect URL to discover OAuth2 configuration values. This MUST be in the form of an absolute URL. */
    openIdConnectUrl: string;
    /** List of the needed scope names. An empty array means no scopes are needed. */
    scopes?: string[];
};
