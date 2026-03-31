import { type ComponentsObject, parseComponentsObject } from './components';
import { type ExternalDocumentationObject, parseExternalDocumentationObject } from './external-documentation';
import { type InfoObject, parseInfoObject } from './info';
import { type PathItemObject, parsePathItemObject } from './path-item';
import { type PathsObject, parsePathsObject } from './paths';
import { type SecurityRequirementObject, parseSecurityRequirementObject } from './security-requirement';
import { type ServerObject, parseServerObject } from './server';
import { type TagObject, parseTagObject } from './tag';
import { validateArray } from './validators/validate-array';
import { validateRecord } from './validators/validate-record';
import { isObject } from './helpers/is-object';

/**
* Openapi object
*
* This is the root object of the [OpenAPI document](#openapi-document).
* 
* @see {@link https://spec.openapis.org/oas/v3.1#openapi-object}
*/
export type Document = {
  /** **REQUIRED**. This string MUST be the [version number](https://spec.openapis.org/oas/v3.1#versions) of the OpenAPI Specification that the OpenAPI document uses. The `openapi` field SHOULD be used by tooling to interpret the OpenAPI document. This is *not* related to the API [`info.version`](https://spec.openapis.org/oas/v3.1#infoVersion) string. */
  openapi: string;
  /** **REQUIRED**. Provides metadata about the API. The metadata MAY be used by tooling as required. */
  info: InfoObject;
  /** The default value for the `$schema` keyword within [Schema Objects](https://spec.openapis.org/oas/v3.1#schema-object) contained within this OAS document. This MUST be in the form of a URI. */
  jsonSchemaDialect?: string;
  /** An array of Server Objects, which provide connectivity information to a target server. If the `servers` property is not provided, or is an empty array, the default value would be a [Server Object](https://spec.openapis.org/oas/v3.1#server-object) with a [url](https://spec.openapis.org/oas/v3.1#serverUrl) value of `/`. */
  servers?: ServerObject[];
  /** The available paths and operations for the API. */
  paths?: PathsObject;
  /** The incoming webhooks that MAY be received as part of this API and that the API consumer MAY choose to implement. Closely related to the `callbacks` feature, this section describes requests initiated other than by an API call, for example by an out of band registration. The key name is a unique string to refer to each webhook, while the (optionally referenced) Path Item Object describes a request that may be initiated by the API provider and the expected responses. An [example](../examples/v3.1/webhook-example.yaml) is available. */
  webhooks?: Record<string, PathItemObject>;
  /** An element to hold various schemas for the document. */
  components?: ComponentsObject;
  /** A declaration of which security mechanisms can be used across the API. The list of values includes alternative security requirement objects that can be used. Only one of the security requirement objects need to be satisfied to authorize a request. Individual operations can override this definition. To make security optional, an empty security requirement (`{}`) can be included in the array. */
  security?: SecurityRequirementObject[];
  /** A list of tags used by the document with additional metadata. The order of the tags can be used to reflect on their order by the parsing tools. Not all tags that are used by the [Operation Object](https://spec.openapis.org/oas/v3.1#operation-object) must be declared. The tags that are not declared MAY be organized randomly or based on the tools' logic. Each tag name in the list MUST be unique. */
  tags?: TagObject[];
  /** Additional external documentation. */
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
  };
}