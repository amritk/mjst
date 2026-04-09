import type { ReferenceObject } from './reference';
import { type CallbacksObject, parseCallbacksObject } from './callbacks';
import { type ExampleObject, parseExampleObject } from './example';
import { type HeaderObject, parseHeaderObject } from './header';
import { type LinkObject, parseLinkObject } from './link';
import { type ParameterObject, parseParameterObject } from './parameter';
import { type PathItemObject, parsePathItemObject } from './path-item';
import { type RequestBodyObject, parseRequestBodyObject } from './request-body';
import { type ResponseObject, parseResponseObject } from './response';
import { type SchemaObject, parseSchemaObject } from './schema';
import { type SecuritySchemeObject, parseSecuritySchemeObject } from './security-scheme';
import { validateRecord } from 'mjst-helpers/validate-record';
import { isObject } from 'mjst-helpers/is-object';

export type ComponentsObject = {
  schemas?: Record<string, SchemaObject>;
  responses?: Record<string, ResponseObject | ReferenceObject>;
  parameters?: Record<string, ParameterObject | ReferenceObject>;
  examples?: Record<string, ExampleObject | ReferenceObject>;
  requestBodies?: Record<string, RequestBodyObject | ReferenceObject>;
  headers?: Record<string, HeaderObject | ReferenceObject>;
  securitySchemes?: Record<string, SecuritySchemeObject | ReferenceObject>;
  links?: Record<string, LinkObject | ReferenceObject>;
  callbacks?: Record<string, CallbacksObject | ReferenceObject>;
  pathItems?: Record<string, PathItemObject>;
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
  } as unknown as ComponentsObject;
}