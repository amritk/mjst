import { type PathItemObject, parsePathItemObject } from './path-item';
import { isObject } from '@amritk/helpers/is-object';

/**
* Paths object
*
* Holds the relative paths to the individual endpoints. The path is appended to the [`basePath`](#swaggerBasePath) in order to construct the full URL. The Paths may be empty, due to [ACL constraints](#security-filtering).
* 
* @see {@link https://swagger.io/specification/v2/#paths-object}
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
    if (/^x-/.test(key)) {
      const value = input[key];
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
};