import { type ComponentsObject, parseComponentsObject } from './components';
import { type ExternalDocumentationObject, parseExternalDocumentationObject } from './external-documentation';
import { type InfoObject, parseInfoObject } from './info';
import { type PathsObject, parsePathsObject } from './paths';
import { type SecurityRequirementObject, parseSecurityRequirementObject } from './security-requirement';
import { type ServerObject, parseServerObject } from './server';
import { type TagObject, parseTagObject } from './tag';
import { validateArray } from '@amritk/helpers/validate-array';
import { isObject } from '@amritk/helpers/is-object';

/**
* Openapi object
*
* This is the root object of the [OpenAPI Description](#openapi-description).
* 
* @see {@link https://spec.openapis.org/oas/v3.0.4#openapi-object}
*/
export type Document = {
  /** **REQUIRED**. This string MUST be the [version number](https://spec.openapis.org/oas/v3.0.4#versions) of the OpenAPI Specification that the OpenAPI Document uses. The `openapi` field SHOULD be used by tooling to interpret the OpenAPI Document. This is _not_ related to the API [`info.version`](https://spec.openapis.org/oas/v3.0.4#info-version) string. */
  openapi: string;
  /** **REQUIRED**. Provides metadata about the API. The metadata MAY be used by tooling as required. */
  info: InfoObject;
  /** Additional external documentation. */
  externalDocs?: ExternalDocumentationObject;
  /** An array of Server Objects, which provide connectivity information to a target server. If the `servers` field is not provided, or is an empty array, the default value would be a [Server Object](https://spec.openapis.org/oas/v3.0.4#server-object) with a [url](https://spec.openapis.org/oas/v3.0.4#server-url) value of `/`. */
  servers?: ServerObject[];
  /** A declaration of which security mechanisms can be used across the API. The list of values includes alternative Security Requirement Objects that can be used. Only one of the Security Requirement Objects need to be satisfied to authorize a request. Individual operations can override this definition. The list can be incomplete, up to being empty or absent. To make security explicitly optional, an empty security requirement (`{}`) can be included in the array. */
  security?: SecurityRequirementObject[];
  /** A list of tags used by the OpenAPI Description with additional metadata. The order of the tags can be used to reflect on their order by the parsing tools. Not all tags that are used by the [Operation Object](https://spec.openapis.org/oas/v3.0.4#operation-object) must be declared. The tags that are not declared MAY be organized randomly or based on the tools' logic. Each tag name in the list MUST be unique. */
  tags?: TagObject[];
  /** **REQUIRED**. The available paths and operations for the API. */
  paths: PathsObject;
  /** An element to hold various Objects for the OpenAPI Description. */
  components?: ComponentsObject;
};

export const parseDocument = (input: unknown): Document => {
  if (!isObject(input)) return {
        openapi: "",
        info: parseInfoObject(undefined),
        paths: parsePathsObject(undefined),
      };
  const _info = input.info;
  const _externalDocs = input.externalDocs;
  const _servers = input.servers;
  const _security = input.security;
  const _tags = input.tags;
  const _paths = input.paths;
  const _components = input.components;
  return {
    ...input,
    openapi: typeof input?.openapi === "string" && /^3\.0\.\d(-.+)?$/.test(input?.openapi) ? input?.openapi : (input?.openapi !== undefined ? String(input?.openapi) : "1.0.0"),
    info: parseInfoObject(_info),
    ...(_externalDocs !== undefined && { externalDocs: parseExternalDocumentationObject(_externalDocs) }),
    ...(_servers !== undefined && { servers: validateArray(_servers, parseServerObject) }),
    ...(_security !== undefined && { security: validateArray(_security, parseSecurityRequirementObject) }),
    ...(_tags !== undefined && { tags: validateArray(_tags, parseTagObject) }),
    paths: parsePathsObject(_paths),
    ...(_components !== undefined && { components: parseComponentsObject(_components) }),
  } as unknown as Document;
}