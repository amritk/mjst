import { type OperationObject, parseOperationObject } from './operation';
import { type ParametersListObject, parseParametersListObject } from './parameters-list';
import { isObject } from '@amritk/helpers/is-object';

/**
* Path Item object
*
* Describes the operations available on a single path. A Path Item may be empty, due to [ACL constraints](#security-filtering). The path itself is still exposed to the documentation viewer but they will not know which operations and parameters are available.
* 
* @see {@link https://swagger.io/specification/v2/#path-item-object}
*/
export type PathItemObject = {
  $ref?: string;
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
  /** A list of parameters that are applicable for all the operations described under this path. These parameters can be overridden at the operation level, but cannot be removed there. The list MUST NOT include duplicated parameters. A unique parameter is defined by a combination of a [name](https://swagger.io/specification/v2/#parameterName) and [location](https://swagger.io/specification/v2/#parameterIn). The list can use the [Reference Object](https://swagger.io/specification/v2/#reference-object) to link to parameters that are defined at the [Swagger Object's parameters](https://swagger.io/specification/v2/#swaggerParameters). There can be one "body" parameter at most. */
  parameters?: ParametersListObject;
};

export const parsePathItemObject = (input: unknown): PathItemObject => {
  if (!isObject(input)) {
    return {} as unknown as PathItemObject;
  }
  const result = {
    ...input,
    ...((value => value === undefined ? {} : { $ref: value })(typeof input?.$ref === "string" ? input?.$ref : (input?.$ref !== undefined ? String(input?.$ref) : undefined))),
    ...(input.get && { get: parseOperationObject(input.get) }),
    ...(input.put && { put: parseOperationObject(input.put) }),
    ...(input.post && { post: parseOperationObject(input.post) }),
    ...(input.delete && { delete: parseOperationObject(input.delete) }),
    ...(input.options && { options: parseOperationObject(input.options) }),
    ...(input.head && { head: parseOperationObject(input.head) }),
    ...(input.patch && { patch: parseOperationObject(input.patch) }),
    ...(input.parameters && { parameters: parseParametersListObject(input.parameters) }),
  } as unknown as PathItemObject;
  for (const key in input) {
    if (/^x-/.test(key)) {
      const value = input[key];
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
};