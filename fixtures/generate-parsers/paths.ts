import { type PathItemObject, parsePathItemObject } from './path-item';
import { isObject } from 'mjst-helpers/is-object';

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