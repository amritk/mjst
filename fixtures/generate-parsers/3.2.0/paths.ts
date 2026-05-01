import { type PathItemObject, parsePathItemObject } from './path-item';
import { isObject } from '@amritk/helpers/is-object';

/**
* Paths object
*
* Holds the relative paths to the individual endpoints and their operations. The path is appended to the URL from the [Server Object](#server-object) in order to construct the full URL. The Paths Object MAY be empty, due to [Access Control List (ACL) constraints](#security-filtering).
* 
* @see {@link https://spec.openapis.org/oas/v3.2#paths-object}
*/
export type PathsObject = Record<string, PathItemObject>;

export const parsePathsObject = (input: unknown): PathsObject => {
  if (!isObject(input)) {
    return {} as unknown as PathsObject;
  }
  const result = {
    ...input,
  } as unknown as PathsObject;
  for (const key in input) {
    if (/^\//.test(key)) {
      const value = input[key];
      (result as Record<string, unknown>)[key] = parsePathItemObject(value);
    }
  }
  return result;
};