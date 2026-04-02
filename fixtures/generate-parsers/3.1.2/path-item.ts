import type { ReferenceObject } from './reference';
import { type OperationObject, parseOperationObject } from './operation';
import { type ParameterObject, parseParameterObject } from './parameter';
import { type ServerObject, parseServerObject } from './server';
import { validateArray } from 'mjst-helpers/validate-array';
import { isObject } from 'mjst-helpers/is-object';

/**
* Path Item object
*
* Describes the operations available on a single path. A Path Item MAY be empty, due to [ACL constraints](#security-filtering). The path itself is still exposed to the documentation viewer but they will not know which operations and parameters are available.
* 
* @see {@link https://spec.openapis.org/oas/v3.1#path-item-object}
*/
export type PathItemObject = {
  $ref?: string;
  /** An optional string summary, intended to apply to all operations in this path. */
  summary?: string;
  /** An optional string description, intended to apply to all operations in this path. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. */
  description?: string;
  /** An alternative `servers` array to service all operations in this path. If a `servers` array is specified at the [OpenAPI Object](https://spec.openapis.org/oas/v3.1#oas-servers) level, it will be overridden by this value. */
  servers?: ServerObject[];
  /** A list of parameters that are applicable for all the operations described under this path. These parameters can be overridden at the operation level, but cannot be removed there. The list MUST NOT include duplicated parameters. A unique parameter is defined by a combination of a [name](https://spec.openapis.org/oas/v3.1#parameter-name) and [location](https://spec.openapis.org/oas/v3.1#parameter-in). The list can use the [Reference Object](https://spec.openapis.org/oas/v3.1#reference-object) to link to parameters that are defined in the [OpenAPI Object's `components.parameters`](https://spec.openapis.org/oas/v3.1#components-parameters). */
  parameters?: ParameterObject | ReferenceObject[];
  /** A definition of a GET operation on this path. */
  get?: OperationObject;
  /** A definition of a PUT operation on this path. */
  put?: OperationObject;
  /** A definition of a POST operation on this path. */
  post?: OperationObject;
  /** A definition of a DELETE operation on this path. */
  delete?: OperationObject;
  /** A definition of a OPTIONS operation on this path. */
  options?: OperationObject;
  /** A definition of a HEAD operation on this path. */
  head?: OperationObject;
  /** A definition of a PATCH operation on this path. */
  patch?: OperationObject;
  /** A definition of a TRACE operation on this path. */
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