import type { ReferenceObject } from './reference';
import { type OperationObject, parseOperationObject } from './operation';
import { type ParameterObject, parseParameterObject } from './parameter';
import { type ServerObject, parseServerObject } from './server';
import { validateArray } from 'mjst-helpers/validate-array';
import { isObject } from 'mjst-helpers/is-object';

export type PathItemObject = {
  $ref?: string;
  summary?: string;
  description?: string;
  servers?: ServerObject[];
  parameters?: (ParameterObject | ReferenceObject)[];
  get?: OperationObject;
  put?: OperationObject;
  post?: OperationObject;
  delete?: OperationObject;
  options?: OperationObject;
  head?: OperationObject;
  patch?: OperationObject;
  trace?: OperationObject;
} & Record<`x-${string}`, unknown>;

export const parsePathItemObject = (input: unknown): PathItemObject => {
  if (!isObject(input)) return {};
  const _servers = input.servers;
  const _parameters = input.parameters;
  const _get = input.get;
  const _put = input.put;
  const _post = input.post;
  const _delete = input.delete;
  const _options = input.options;
  const _head = input.head;
  const _patch = input.patch;
  const _trace = input.trace;
  return {
    ...input,
    ...(input.$ref !== undefined && { $ref: typeof input?.$ref === "string" ? input?.$ref : String(input?.$ref) }),
    ...(input.summary !== undefined && { summary: typeof input?.summary === "string" ? input?.summary : String(input?.summary) }),
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
    ...(_servers !== undefined && { servers: validateArray(_servers, parseServerObject) }),
    ...(_parameters !== undefined && { parameters: validateArray(_parameters, parseParameterObject) }),
    ...(_get !== undefined && { get: parseOperationObject(_get) }),
    ...(_put !== undefined && { put: parseOperationObject(_put) }),
    ...(_post !== undefined && { post: parseOperationObject(_post) }),
    ...(_delete !== undefined && { delete: parseOperationObject(_delete) }),
    ...(_options !== undefined && { options: parseOperationObject(_options) }),
    ...(_head !== undefined && { head: parseOperationObject(_head) }),
    ...(_patch !== undefined && { patch: parseOperationObject(_patch) }),
    ...(_trace !== undefined && { trace: parseOperationObject(_trace) }),
  };
}