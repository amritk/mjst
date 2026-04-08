import { type CallbackObject, parseCallbackObject } from './callback';
import { type ExternalDocumentationObject, parseExternalDocumentationObject } from './external-documentation';
import { type ParameterObject, parseParameterObject } from './parameter';
import { type ReferenceObject, parseReferenceObject } from './reference';
import { type RequestBodyObject, parseRequestBodyObject } from './request-body';
import { type ResponsesObject, parseResponsesObject } from './responses';
import { type SecurityRequirementObject, parseSecurityRequirementObject } from './security-requirement';
import { type ServerObject, parseServerObject } from './server';
import { validateArray } from 'mjst-helpers/validate-array';
import { isObject } from 'mjst-helpers/is-object';

/**
* Operation object
*
* Describes a single API operation on a path.
* 
* @see {@link https://spec.openapis.org/oas/v3.0.4#operation-object}
*/
export type OperationObject = {
  /** A list of tags for API documentation control. Tags can be used for logical grouping of operations by resources or any other qualifier. */
  tags?: string[];
  /** A short summary of what the operation does. */
  summary?: string;
  /** A verbose explanation of the operation behavior. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. */
  description?: string;
  /** Additional external documentation for this operation. */
  externalDocs?: ExternalDocumentationObject;
  /** Unique string used to identify the operation. The id MUST be unique among all operations described in the API. The operationId value is **case-sensitive**. Tools and libraries MAY use the operationId to uniquely identify an operation, therefore, it is RECOMMENDED to follow common programming naming conventions. */
  operationId?: string;
  /** A list of parameters that are applicable for this operation. If a parameter is already defined in the [Path Item](https://spec.openapis.org/oas/v3.0.4#path-item-parameters), the new definition will override it but can never remove it. The list MUST NOT include duplicated parameters. A unique parameter is defined by a combination of a [name](https://spec.openapis.org/oas/v3.0.4#parameter-name) and [location](https://spec.openapis.org/oas/v3.0.4#parameter-in). The list can use the [Reference Object](https://spec.openapis.org/oas/v3.0.4#reference-object) to link to parameters that are defined in the [OpenAPI Object's `components.parameters`](https://spec.openapis.org/oas/v3.0.4#components-parameters). */
  parameters?: (ParameterObject | ReferenceObject)[];
  /** The request body applicable for this operation. The `requestBody` is only supported in HTTP methods where the HTTP 1.1 specification [RFC7231](https://tools.ietf.org/html/rfc7231#section-4.3.1) has explicitly defined semantics for request bodies. In other cases where the HTTP spec is vague (such as [GET](https://tools.ietf.org/html/rfc7231#section-4.3.1), [HEAD](https://tools.ietf.org/html/rfc7231#section-4.3.2) and [DELETE](https://tools.ietf.org/html/rfc7231#section-4.3.5)), `requestBody` SHALL be ignored by consumers. */
  requestBody?: RequestBodyObject | ReferenceObject;
  /** **REQUIRED**. The list of possible responses as they are returned from executing this operation. */
  responses: ResponsesObject;
  /** A map of possible out-of band callbacks related to the parent operation. The key is a unique identifier for the Callback Object. Each value in the map is a [Callback Object](https://spec.openapis.org/oas/v3.0.4#callback-object) that describes a request that may be initiated by the API provider and the expected responses. */
  callbacks?: Record<string, CallbackObject | ReferenceObject>;
  /** Declares this operation to be deprecated. Consumers SHOULD refrain from usage of the declared operation. Default value is `false`. */
  deprecated?: boolean;
  /** A declaration of which security mechanisms can be used for this operation. The list of values includes alternative Security Requirement Objects that can be used. Only one of the Security Requirement Objects need to be satisfied to authorize a request. To make security optional, an empty security requirement (`{}`) can be included in the array. This definition overrides any declared top-level [`security`](https://spec.openapis.org/oas/v3.0.4#oas-security). To remove a top-level security declaration, an empty array can be used. */
  security?: SecurityRequirementObject[];
  /** An alternative `servers` array to service this operation. If a `servers` array is specified at the [Path Item Object](https://spec.openapis.org/oas/v3.0.4#path-item-servers) or [OpenAPI Object](https://spec.openapis.org/oas/v3.0.4#oas-servers) level, it will be overridden by this value. */
  servers?: ServerObject[];
};

export const parseOperationObject = (input: unknown): OperationObject => {
  if (!isObject(input)) return {
        responses: parseResponsesObject(undefined),
      };
  const _externalDocs = input.externalDocs;
  const _responses = input.responses;
  const _security = input.security;
  const _servers = input.servers;
  return {
    ...input,
    ...(input.tags !== undefined && { tags: Array.isArray(input?.tags) ? input?.tags : [] }),
    ...(input.summary !== undefined && { summary: typeof input?.summary === "string" ? input?.summary : String(input?.summary) }),
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
    ...(_externalDocs !== undefined && { externalDocs: parseExternalDocumentationObject(_externalDocs) }),
    ...(input.operationId !== undefined && { operationId: typeof input?.operationId === "string" ? input?.operationId : String(input?.operationId) }),
    ...(input.parameters !== undefined && { parameters: Array.isArray(input?.parameters) && new Set(input?.parameters).size === input?.parameters.length ? input?.parameters : [] }),
    ...(input.requestBody !== undefined && { requestBody: input?.requestBody ?? undefined }),
    responses: parseResponsesObject(_responses),
    ...(input.callbacks !== undefined && { callbacks: isObject(input?.callbacks) ? input?.callbacks : typeof input?.callbacks === "object" && input?.callbacks !== null ? input?.callbacks : {} }),
    ...(input.deprecated !== undefined && { deprecated: typeof input?.deprecated === "boolean" ? input?.deprecated : Boolean(input?.deprecated) }),
    ...(_security !== undefined && { security: validateArray(_security, parseSecurityRequirementObject) }),
    ...(_servers !== undefined && { servers: validateArray(_servers, parseServerObject) }),
  } as unknown as OperationObject;
}