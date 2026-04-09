import { type ComponentsObject, parseComponentsObject } from './components';
import { type ExternalDocumentationObject, parseExternalDocumentationObject } from './external-documentation';
import { type InfoObject, parseInfoObject } from './info';
import { type PathItemObject, parsePathItemObject } from './path-item';
import { type PathsObject, parsePathsObject } from './paths';
import { type SecurityRequirementObject, parseSecurityRequirementObject } from './security-requirement';
import { type ServerObject, parseServerObject } from './server';
import { type TagObject, parseTagObject } from './tag';
import { validateArray } from 'mjst-helpers/validate-array';
import { validateRecord } from 'mjst-helpers/validate-record';
import { isObject } from 'mjst-helpers/is-object';

export type Document = {
  openapi: string;
  info: InfoObject;
  jsonSchemaDialect?: string;
  servers?: ServerObject[];
  paths?: PathsObject;
  webhooks?: Record<string, PathItemObject>;
  components?: ComponentsObject;
  security?: SecurityRequirementObject[];
  tags?: TagObject[];
  externalDocs?: ExternalDocumentationObject;
} & Record<`x-${string}`, unknown>;

export const parseDocument = (input: unknown): Document => {
  if (!isObject(input)) return {
        openapi: "",
        info: parseInfoObject(undefined),
      };
  const _info = input.info;
  const _servers = input.servers;
  const _paths = input.paths;
  const _webhooks = input.webhooks;
  const _components = input.components;
  const _security = input.security;
  const _tags = input.tags;
  const _externalDocs = input.externalDocs;
  return {
    ...input,
    openapi: typeof input?.openapi === "string" && /^3\.1\.\d+(-.+)?$/.test(input?.openapi) ? input?.openapi : (input?.openapi !== undefined ? String(input?.openapi) : "1.0.0"),
    info: parseInfoObject(_info),
    ...(input.jsonSchemaDialect !== undefined && { jsonSchemaDialect: typeof input?.jsonSchemaDialect === "string" ? input?.jsonSchemaDialect : String(input?.jsonSchemaDialect) }),
    ...(_servers !== undefined && { servers: validateArray(_servers, parseServerObject) }),
    ...(_paths !== undefined && { paths: parsePathsObject(_paths) }),
    ...(_webhooks !== undefined && { webhooks: validateRecord(_webhooks, parsePathItemObject) }),
    ...(_components !== undefined && { components: parseComponentsObject(_components) }),
    ...(_security !== undefined && { security: validateArray(_security, parseSecurityRequirementObject) }),
    ...(_tags !== undefined && { tags: validateArray(_tags, parseTagObject) }),
    ...(_externalDocs !== undefined && { externalDocs: parseExternalDocumentationObject(_externalDocs) }),
  } as unknown as Document;
}