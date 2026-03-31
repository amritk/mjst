import { type MapOfStringsObject, parseMapOfStringsObject } from './map-of-strings';
import { isObject } from './helpers/is-object';

export type PasswordObject = {
  tokenUrl: string;
  refreshUrl?: string;
  scopes: MapOfStringsObject;
} & Record<`x-${string}`, unknown>;

export const parsePasswordObject = (input: unknown): PasswordObject => {
  if (!isObject(input)) return {
        tokenUrl: "",
        scopes: parseMapOfStringsObject(undefined),
      };
  const _scopes = input.scopes;
  return {
    ...input,
    tokenUrl: typeof input?.tokenUrl === "string" ? input?.tokenUrl : (input?.tokenUrl !== undefined ? String(input?.tokenUrl) : ""),
    ...(input.refreshUrl !== undefined && { refreshUrl: typeof input?.refreshUrl === "string" ? input?.refreshUrl : String(input?.refreshUrl) }),
    scopes: parseMapOfStringsObject(_scopes),
  };
}