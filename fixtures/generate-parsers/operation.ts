import type { ReferenceObject } from './reference';
import { type CallbacksObject, parseCallbacksObject } from './callbacks';
import { type ExternalDocumentationObject, parseExternalDocumentationObject } from './external-documentation';
import { type ParameterObject, parseParameterObject } from './parameter';
import { type RequestBodyObject, parseRequestBodyObject } from './request-body';
import { type ResponsesObject, parseResponsesObject } from './responses';
import { type SecurityRequirementObject, parseSecurityRequirementObject } from './security-requirement';
import { type ServerObject, parseServerObject } from './server';
import { validateArray } from 'mjst-helpers/validate-array';
import { validateRecord } from 'mjst-helpers/validate-record';
import { isObject } from 'mjst-helpers/is-object';

export type OperationObject = {
  tags?: string[];
  summary?: string;
  description?: string;
  externalDocs?: ExternalDocumentationObject;
  operationId?: string;
  parameters?: (ParameterObject | ReferenceObject)[];
  requestBody?: RequestBodyObject | ReferenceObject;
  responses?: ResponsesObject;
  callbacks?: Record<string, CallbacksObject | ReferenceObject>;
  deprecated?: boolean;
  security?: SecurityRequirementObject[];
  servers?: ServerObject[];
} & Record<`x-${string}`, unknown>;

export const parseOperationObject = (input: unknown): OperationObject => {
  if (!isObject(input)) return {} as OperationObject;
  const _externalDocs = input.externalDocs;
  const _parameters = input.parameters;
  const _requestBody = input.requestBody;
  const _responses = input.responses;
  const _callbacks = input.callbacks;
  const _security = input.security;
  const _servers = input.servers;
  return {
    ...input,
    ...(input.tags !== undefined && { tags: Array.isArray(input?.tags) ? input?.tags : [] }),
    ...(input.summary !== undefined && { summary: typeof input?.summary === "string" ? input?.summary : String(input?.summary) }),
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
    ...(_externalDocs !== undefined && { externalDocs: parseExternalDocumentationObject(_externalDocs) }),
    ...(input.operationId !== undefined && { operationId: typeof input?.operationId === "string" ? input?.operationId : String(input?.operationId) }),
    ...(_parameters !== undefined && { parameters: validateArray(_parameters, parseParameterObject) }),
    ...(_requestBody !== undefined && { requestBody: parseRequestBodyObject(_requestBody) }),
    ...(_responses !== undefined && { responses: parseResponsesObject(_responses) }),
    ...(_callbacks !== undefined && { callbacks: validateRecord(_callbacks, parseCallbacksObject) }),
    ...(input.deprecated !== undefined && { deprecated: typeof input?.deprecated === "boolean" ? input?.deprecated : Boolean(input?.deprecated) }),
    ...(_security !== undefined && { security: validateArray(_security, parseSecurityRequirementObject) }),
    ...(_servers !== undefined && { servers: validateArray(_servers, parseServerObject) }),
  } as unknown as OperationObject;
}