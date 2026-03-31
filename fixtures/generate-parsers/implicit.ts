import { type MapOfStringsObject, parseMapOfStringsObject } from './map-of-strings';
import { isObject } from './helpers/is-object';

export type ImplicitObject = {
  authorizationUrl: string;
  refreshUrl?: string;
  scopes: MapOfStringsObject;
} & Record<`x-${string}`, unknown>;

export const parseImplicitObject = (input: unknown): ImplicitObject => {
  if (!isObject(input)) return {
        authorizationUrl: "",
        scopes: parseMapOfStringsObject(undefined),
      };
  const _scopes = input.scopes;
  return {
    ...input,
    authorizationUrl: typeof input?.authorizationUrl === "string" ? input?.authorizationUrl : (input?.authorizationUrl !== undefined ? String(input?.authorizationUrl) : ""),
    ...(input.refreshUrl !== undefined && { refreshUrl: typeof input?.refreshUrl === "string" ? input?.refreshUrl : String(input?.refreshUrl) }),
    scopes: parseMapOfStringsObject(_scopes),
  };
}