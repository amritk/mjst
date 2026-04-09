import { type MapOfStringsObject, parseMapOfStringsObject } from './map-of-strings';
import { isObject } from 'mjst-helpers/is-object';

export type AuthorizationCodeObject = {
  authorizationUrl: string;
  tokenUrl: string;
  refreshUrl?: string;
  scopes: MapOfStringsObject;
} & Record<`x-${string}`, unknown>;

export const parseAuthorizationCodeObject = (input: unknown): AuthorizationCodeObject => {
  if (!isObject(input)) return {
        authorizationUrl: "",
        tokenUrl: "",
        scopes: parseMapOfStringsObject(undefined),
      };
  const _scopes = input.scopes;
  return {
    ...input,
    authorizationUrl: typeof input?.authorizationUrl === "string" ? input?.authorizationUrl : (input?.authorizationUrl !== undefined ? String(input?.authorizationUrl) : ""),
    tokenUrl: typeof input?.tokenUrl === "string" ? input?.tokenUrl : (input?.tokenUrl !== undefined ? String(input?.tokenUrl) : ""),
    ...(input.refreshUrl !== undefined && { refreshUrl: typeof input?.refreshUrl === "string" ? input?.refreshUrl : String(input?.refreshUrl) }),
    scopes: parseMapOfStringsObject(_scopes),
  } as unknown as AuthorizationCodeObject;
}