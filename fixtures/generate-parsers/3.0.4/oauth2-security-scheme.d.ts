import type { OAuthFlowsObject } from './oauth-flows';
export type OAuth2SecuritySchemeObject = {
    type: "oauth2";
    flows: OAuthFlowsObject;
    description?: string;
};
