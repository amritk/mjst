import type { APIKeySecuritySchemeObject } from './api-key-security-scheme';
import type { HTTPSecuritySchemeObject } from './http-security-scheme';
import type { OAuth2SecuritySchemeObject } from './oauth2-security-scheme';
import type { OpenIdConnectSecuritySchemeObject } from './open-id-connect-security-scheme';
export type SecuritySchemeObject = APIKeySecuritySchemeObject | HTTPSecuritySchemeObject | OAuth2SecuritySchemeObject | OpenIdConnectSecuritySchemeObject;
