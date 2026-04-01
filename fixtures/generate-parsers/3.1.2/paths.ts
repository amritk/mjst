import { type PathItemObject, parsePathItemObject } from './path-item';
import { isObject } from 'mjst-helpers/is-object';

/**
* Paths object
*
* Holds the relative paths to the individual endpoints and their operations. The path is appended to the URL from the [`Server Object`](#server-object) in order to construct the full URL.  The Paths MAY be empty, due to [Access Control List (ACL) constraints](#security-filtering).
* 
* @see {@link https://spec.openapis.org/oas/v3.1#paths-object}
*/
export type PathsObject = Record<string, PathItemObject>;

export const parsePathsObject = (input: unknown): PathsObject => {
  if (!isObject(input)) {
    return {};
  }
  const result: PathsObject = {
    ...input,
  };
  for (const key in input) {
    if (/^\//.test(key)) {
      const value = input[key];
      result[key] = parsePathItemObject(value);
    }
  }
  return result;
};