import type { ReferenceObject } from './reference';
import { type CallbacksObject, parseCallbacksObject } from './callbacks';
import { type ExampleObject, parseExampleObject } from './example';
import { type HeaderObject, parseHeaderObject } from './header';
import { type LinkObject, parseLinkObject } from './link';
import { type MediaTypeObject, parseMediaTypeObject } from './media-type';
import { type ParameterObject, parseParameterObject } from './parameter';
import { type PathItemObject, parsePathItemObject } from './path-item';
import { type RequestBodyObject, parseRequestBodyObject } from './request-body';
import { type ResponseObject, parseResponseObject } from './response';
import { type SchemaObject, parseSchemaObject } from './schema';
import { type SecuritySchemeObject, parseSecuritySchemeObject } from './security-scheme';
import { validateRecord } from 'mjst-helpers/validate-record';
import { isObject } from 'mjst-helpers/is-object';

/**
* Components object
*
* Holds a set of reusable objects for different aspects of the OAS. All objects defined within the Components Object will have no effect on the API unless they are explicitly referenced from outside the Components Object.
* 
* @see {@link https://spec.openapis.org/oas/v3.2#components-object}
*/
export type ComponentsObject = {
  /** An object to hold reusable [Schema Objects](https://spec.openapis.org/oas/v3.2#schema-object). */
  schemas?: Record<string, SchemaObject>;
  /** An object to hold reusable [Response Objects](https://spec.openapis.org/oas/v3.2#response-object). */
  responses?: Record<string, ResponseObject | ReferenceObject>;
  /** An object to hold reusable [Parameter Objects](https://spec.openapis.org/oas/v3.2#parameter-object). */
  parameters?: Record<string, ParameterObject | ReferenceObject>;
  /** An object to hold reusable [Example Objects](https://spec.openapis.org/oas/v3.2#example-object). */
  examples?: Record<string, ExampleObject | ReferenceObject>;
  /** An object to hold reusable [Request Body Objects](https://spec.openapis.org/oas/v3.2#request-body-object). */
  requestBodies?: Record<string, RequestBodyObject | ReferenceObject>;
  /** An object to hold reusable [Header Objects](https://spec.openapis.org/oas/v3.2#header-object). */
  headers?: Record<string, HeaderObject | ReferenceObject>;
  /** An object to hold reusable [Security Scheme Objects](https://spec.openapis.org/oas/v3.2#security-scheme-object). */
  securitySchemes?: Record<string, SecuritySchemeObject | ReferenceObject>;
  /** An object to hold reusable [Link Objects](https://spec.openapis.org/oas/v3.2#link-object). */
  links?: Record<string, LinkObject | ReferenceObject>;
  /** An object to hold reusable [Callback Objects](https://spec.openapis.org/oas/v3.2#callback-object). */
  callbacks?: Record<string, CallbacksObject | ReferenceObject>;
  /** An object to hold reusable [Path Item Objects](https://spec.openapis.org/oas/v3.2#path-item-object). */
  pathItems?: Record<string, PathItemObject>;
  /** An object to hold reusable [Media Type Objects](https://spec.openapis.org/oas/v3.2#media-type-object). */
  mediaTypes?: Record<string, MediaTypeObject | ReferenceObject>;
} & Record<`x-${string}`, unknown>;

export const parseComponentsObject = (input: unknown): ComponentsObject => {
  if (!isObject(input)) return {} as ComponentsObject;
  const _schemas = input.schemas;
  const _responses = input.responses;
  const _parameters = input.parameters;
  const _examples = input.examples;
  const _requestBodies = input.requestBodies;
  const _headers = input.headers;
  const _securitySchemes = input.securitySchemes;
  const _links = input.links;
  const _callbacks = input.callbacks;
  const _pathItems = input.pathItems;
  const _mediaTypes = input.mediaTypes;
  return {
    ...input,
    ...(_schemas !== undefined && { schemas: validateRecord(_schemas, parseSchemaObject) }),
    ...(_responses !== undefined && { responses: validateRecord(_responses, parseResponseObject) }),
    ...(_parameters !== undefined && { parameters: validateRecord(_parameters, parseParameterObject) }),
    ...(_examples !== undefined && { examples: validateRecord(_examples, parseExampleObject) }),
    ...(_requestBodies !== undefined && { requestBodies: validateRecord(_requestBodies, parseRequestBodyObject) }),
    ...(_headers !== undefined && { headers: validateRecord(_headers, parseHeaderObject) }),
    ...(_securitySchemes !== undefined && { securitySchemes: validateRecord(_securitySchemes, parseSecuritySchemeObject) }),
    ...(_links !== undefined && { links: validateRecord(_links, parseLinkObject) }),
    ...(_callbacks !== undefined && { callbacks: validateRecord(_callbacks, parseCallbacksObject) }),
    ...(_pathItems !== undefined && { pathItems: validateRecord(_pathItems, parsePathItemObject) }),
    ...(_mediaTypes !== undefined && { mediaTypes: validateRecord(_mediaTypes, parseMediaTypeObject) }),
  } as unknown as ComponentsObject;
}