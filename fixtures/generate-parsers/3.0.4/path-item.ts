import { type OperationObject, parseOperationObject } from './operation';
import { type ParameterObject, parseParameterObject } from './parameter';
import { type ReferenceObject, parseReferenceObject } from './reference';
import { type ServerObject, parseServerObject } from './server';
import { validateArray } from '@amritk/helpers/validate-array';
import { isObject } from '@amritk/helpers/is-object';

/**
* Path Item object
*
* Describes the operations available on a single path. A Path Item MAY be empty, due to [ACL constraints](#security-filtering). The path itself is still exposed to the documentation viewer but they will not know which operations and parameters are available.
* 
* @see {@link https://spec.openapis.org/oas/v3.0.4#path-item-object}
*/
export type PathItemObject = {
  $ref?: string;
  /** An optional string summary, intended to apply to all operations in this path. */
  summary?: string;
  /** An optional string description, intended to apply to all operations in this path. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. */
  description?: string;
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
  /** An alternative `servers` array to service all operations in this path. If a `servers` array is specified at the [OpenAPI Object](https://spec.openapis.org/oas/v3.0.4#oas-servers) level, it will be overridden by this value. */
  servers?: ServerObject[];
  /** A list of parameters that are applicable for all the operations described under this path. These parameters can be overridden at the operation level, but cannot be removed there. The list MUST NOT include duplicated parameters. A unique parameter is defined by a combination of a [name](https://spec.openapis.org/oas/v3.0.4#parameter-name) and [location](https://spec.openapis.org/oas/v3.0.4#parameter-in). The list can use the [Reference Object](https://spec.openapis.org/oas/v3.0.4#reference-object) to link to parameters that are defined in the [OpenAPI Object's `components.parameters`](https://spec.openapis.org/oas/v3.0.4#components-parameters). */
  parameters?: (ParameterObject | ReferenceObject)[];
};

export const parsePathItemObject = (input: unknown): PathItemObject => {
  if (!isObject(input)) return {} as PathItemObject;
  const _get = input.get;
  const _put = input.put;
  const _post = input.post;
  const _delete = input.delete;
  const _options = input.options;
  const _head = input.head;
  const _patch = input.patch;
  const _trace = input.trace;
  const _servers = input.servers;
  return {
    ...input,
    ...(input.$ref !== undefined && { $ref: typeof input?.$ref === "string" ? input?.$ref : String(input?.$ref) }),
    ...(input.summary !== undefined && { summary: typeof input?.summary === "string" ? input?.summary : String(input?.summary) }),
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
    ...(_get !== undefined && { get: parseOperationObject(_get) }),
    ...(_put !== undefined && { put: parseOperationObject(_put) }),
    ...(_post !== undefined && { post: parseOperationObject(_post) }),
    ...(_delete !== undefined && { delete: parseOperationObject(_delete) }),
    ...(_options !== undefined && { options: parseOperationObject(_options) }),
    ...(_head !== undefined && { head: parseOperationObject(_head) }),
    ...(_patch !== undefined && { patch: parseOperationObject(_patch) }),
    ...(_trace !== undefined && { trace: parseOperationObject(_trace) }),
    ...(_servers !== undefined && { servers: validateArray(_servers, parseServerObject) }),
    ...(input.parameters !== undefined && { parameters: Array.isArray(input?.parameters) && new Set(input?.parameters).size === input?.parameters.length ? input?.parameters : [] }),
  } as unknown as PathItemObject;
}