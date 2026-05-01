import { type OperationObject, parseOperationObject } from './operation';
import { type ParametersObject, parseParametersObject } from './parameters';
import { type ServerObject, parseServerObject } from './server';
import { validateArray } from '@amritk/helpers/validate-array';
import { validateRecord } from '@amritk/helpers/validate-record';
import { isObject } from '@amritk/helpers/is-object';

/**
* Path Item object
*
* Describes the operations available on a single path. A Path Item MAY be empty, due to [ACL constraints](#security-filtering). The path itself is still exposed to the documentation viewer but they will not know which operations and parameters are available.
* 
* @see {@link https://spec.openapis.org/oas/v3.2#path-item-object}
*/
export type PathItemObject = {
  $ref?: string;
  /** An optional string summary, intended to apply to all operations in this path. */
  summary?: string;
  /** An optional string description, intended to apply to all operations in this path. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. */
  description?: string;
  /** An alternative `servers` array to service all operations in this path. If a `servers` array is specified at the [OpenAPI Object](https://spec.openapis.org/oas/v3.2#oas-servers) level, it will be overridden by this value. */
  servers?: ServerObject[];
  /** A list of parameters that are applicable for all the operations described under this path. These parameters can be overridden at the operation level, but cannot be removed there. The list MUST NOT include duplicated parameters. A unique parameter is defined by a combination of a [name](https://spec.openapis.org/oas/v3.2#parameter-name) and [location](https://spec.openapis.org/oas/v3.2#parameter-in). The list can use the [Reference Object](https://spec.openapis.org/oas/v3.2#reference-object) to link to parameters that are defined in the [OpenAPI Object's `components.parameters`](https://spec.openapis.org/oas/v3.2#components-parameters). */
  parameters?: ParametersObject;
  /** A map of additional operations on this path. The map key is the HTTP method with the same capitalization that is to be sent in the request. This map MUST NOT contain any entry for the methods that can be defined by other fixed fields with Operation Object values (e.g. no `POST` entry, as the `post` field is used for this method). */
  additionalOperations?: Record<string, OperationObject>;
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
  /** A definition of a QUERY operation, as defined in the most recent IETF draft ([draft-ietf-httpbis-safe-method-w-body-08](https://www.ietf.org/archive/id/draft-ietf-httpbis-safe-method-w-body-11.html) as of this writing) or its RFC successor, on this path. */
  query?: OperationObject;
} & Record<`x-${string}`, unknown>;

export const parsePathItemObject = (input: unknown): PathItemObject => {
  if (!isObject(input)) return {} as PathItemObject;
  const _servers = input.servers;
  const _parameters = input.parameters;
  const _additionalOperations = input.additionalOperations;
  const _get = input.get;
  const _put = input.put;
  const _post = input.post;
  const _delete = input.delete;
  const _options = input.options;
  const _head = input.head;
  const _patch = input.patch;
  const _trace = input.trace;
  const _query = input.query;
  return {
    ...input,
    ...(input.$ref !== undefined && { $ref: typeof input?.$ref === "string" ? input?.$ref : String(input?.$ref) }),
    ...(input.summary !== undefined && { summary: typeof input?.summary === "string" ? input?.summary : String(input?.summary) }),
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
    ...(_servers !== undefined && { servers: validateArray(_servers, parseServerObject) }),
    ...(_parameters !== undefined && { parameters: parseParametersObject(_parameters) }),
    ...(_additionalOperations !== undefined && { additionalOperations: validateRecord(_additionalOperations, parseOperationObject) }),
    ...(_get !== undefined && { get: parseOperationObject(_get) }),
    ...(_put !== undefined && { put: parseOperationObject(_put) }),
    ...(_post !== undefined && { post: parseOperationObject(_post) }),
    ...(_delete !== undefined && { delete: parseOperationObject(_delete) }),
    ...(_options !== undefined && { options: parseOperationObject(_options) }),
    ...(_head !== undefined && { head: parseOperationObject(_head) }),
    ...(_patch !== undefined && { patch: parseOperationObject(_patch) }),
    ...(_trace !== undefined && { trace: parseOperationObject(_trace) }),
    ...(_query !== undefined && { query: parseOperationObject(_query) }),
  } as unknown as PathItemObject;
}