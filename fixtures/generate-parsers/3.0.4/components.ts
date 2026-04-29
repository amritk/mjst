import { type CallbackObject, parseCallbackObject } from './callback';
import { type ExampleObject, parseExampleObject } from './example';
import { type HeaderObject, parseHeaderObject } from './header';
import { type LinkObject, parseLinkObject } from './link';
import { type ParameterObject, parseParameterObject } from './parameter';
import { type ReferenceObject, parseReferenceObject } from './reference';
import { type RequestBodyObject, parseRequestBodyObject } from './request-body';
import { type ResponseObject, parseResponseObject } from './response';
import { type SchemaObject, parseSchemaObject } from './schema';
import { type SecuritySchemeObject, parseSecuritySchemeObject } from './security-scheme';
import { isObject } from '@amritk/helpers/is-object';

/**
* Components object
*
* Holds a set of reusable objects for different aspects of the OAS. All objects defined within the Components Object will have no effect on the API unless they are explicitly referenced from outside the Components Object.
* 
* @see {@link https://spec.openapis.org/oas/v3.0.4#components-object}
*/
export type ComponentsObject = {
  /** An object to hold reusable [Schema Objects](https://spec.openapis.org/oas/v3.0.4#schema-object). */
  schemas?: Record<string, SchemaObject | ReferenceObject>;
  /** An object to hold reusable [Response Objects](https://spec.openapis.org/oas/v3.0.4#response-object). */
  responses?: Record<string, ReferenceObject | ResponseObject>;
  /** An object to hold reusable [Parameter Objects](https://spec.openapis.org/oas/v3.0.4#parameter-object). */
  parameters?: Record<string, ReferenceObject | ParameterObject>;
  /** An object to hold reusable [Example Objects](https://spec.openapis.org/oas/v3.0.4#example-object). */
  examples?: Record<string, ReferenceObject | ExampleObject>;
  /** An object to hold reusable [Request Body Objects](https://spec.openapis.org/oas/v3.0.4#request-body-object). */
  requestBodies?: Record<string, ReferenceObject | RequestBodyObject>;
  /** An object to hold reusable [Header Objects](https://spec.openapis.org/oas/v3.0.4#header-object). */
  headers?: Record<string, ReferenceObject | HeaderObject>;
  /** An object to hold reusable [Security Scheme Objects](https://spec.openapis.org/oas/v3.0.4#security-scheme-object). */
  securitySchemes?: Record<string, ReferenceObject | SecuritySchemeObject>;
  /** An object to hold reusable [Link Objects](https://spec.openapis.org/oas/v3.0.4#link-object). */
  links?: Record<string, ReferenceObject | LinkObject>;
  /** An object to hold reusable [Callback Objects](https://spec.openapis.org/oas/v3.0.4#callback-object). */
  callbacks?: Record<string, ReferenceObject | CallbackObject>;
};

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
  if ((_schemas === undefined || isObject(_schemas)) && (_responses === undefined || isObject(_responses)) && (_parameters === undefined || isObject(_parameters)) && (_examples === undefined || isObject(_examples)) && (_requestBodies === undefined || isObject(_requestBodies)) && (_headers === undefined || isObject(_headers)) && (_securitySchemes === undefined || isObject(_securitySchemes)) && (_links === undefined || isObject(_links)) && (_callbacks === undefined || isObject(_callbacks))) return { ...input } as ComponentsObject;
  return {
    ...input,
    ...(_schemas !== undefined && { schemas: isObject(_schemas) ? _schemas : typeof _schemas === "object" && _schemas !== null ? _schemas : {} }),
    ...(_responses !== undefined && { responses: isObject(_responses) ? _responses : typeof _responses === "object" && _responses !== null ? _responses : {} }),
    ...(_parameters !== undefined && { parameters: isObject(_parameters) ? _parameters : typeof _parameters === "object" && _parameters !== null ? _parameters : {} }),
    ...(_examples !== undefined && { examples: isObject(_examples) ? _examples : typeof _examples === "object" && _examples !== null ? _examples : {} }),
    ...(_requestBodies !== undefined && { requestBodies: isObject(_requestBodies) ? _requestBodies : typeof _requestBodies === "object" && _requestBodies !== null ? _requestBodies : {} }),
    ...(_headers !== undefined && { headers: isObject(_headers) ? _headers : typeof _headers === "object" && _headers !== null ? _headers : {} }),
    ...(_securitySchemes !== undefined && { securitySchemes: isObject(_securitySchemes) ? _securitySchemes : typeof _securitySchemes === "object" && _securitySchemes !== null ? _securitySchemes : {} }),
    ...(_links !== undefined && { links: isObject(_links) ? _links : typeof _links === "object" && _links !== null ? _links : {} }),
    ...(_callbacks !== undefined && { callbacks: isObject(_callbacks) ? _callbacks : typeof _callbacks === "object" && _callbacks !== null ? _callbacks : {} }),
  } as unknown as ComponentsObject;
}