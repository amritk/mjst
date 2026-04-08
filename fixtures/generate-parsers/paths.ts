import { type PathItemObject, parsePathItemObject } from './path-item';
import { isObject } from 'mjst-helpers/is-object';

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