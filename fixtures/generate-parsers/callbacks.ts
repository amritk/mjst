import { type PathItemObject, parsePathItemObject } from './path-item';
import { validateRecord } from 'mjst-helpers/validate-record';

export type CallbacksObject = {
  [key: string]: PathItemObject;
};

export const parseCallbacksObject = (input: unknown): CallbacksObject => validateRecord(input, parsePathItemObject) as CallbacksObject;