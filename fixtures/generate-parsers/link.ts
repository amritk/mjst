import { type MapOfStringsObject, parseMapOfStringsObject } from './map-of-strings';
import { type ServerObject, parseServerObject } from './server';
import { isObject } from 'mjst-helpers/is-object';

export type LinkObject = {
  operationRef?: string;
  operationId?: string;
  parameters?: MapOfStringsObject;
  requestBody?: boolean;
  description?: string;
  server?: ServerObject;
} & Record<`x-${string}`, unknown>;

export const parseLinkObject = (input: unknown): LinkObject => {
  if (!isObject(input)) return {};
  const _parameters = input.parameters;
  const _server = input.server;
  return {
    ...input,
    ...(input.operationRef !== undefined && { operationRef: typeof input?.operationRef === "string" ? input?.operationRef : String(input?.operationRef) }),
    ...(input.operationId !== undefined && { operationId: typeof input?.operationId === "string" ? input?.operationId : String(input?.operationId) }),
    ...(_parameters !== undefined && { parameters: parseMapOfStringsObject(_parameters) }),
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
    ...(_server !== undefined && { server: parseServerObject(_server) }),
  };
}