import { type DefinitionsObject, parseDefinitionsObject } from './definitions';
import { type ExternalDocsObject, parseExternalDocsObject } from './external-docs';
import { type InfoObject, parseInfoObject } from './info';
import { type MediaTypeListObject, parseMediaTypeListObject } from './media-type-list';
import { type ParameterDefinitionsObject, parseParameterDefinitionsObject } from './parameter-definitions';
import { type PathsObject, parsePathsObject } from './paths';
import { type ResponseDefinitionsObject, parseResponseDefinitionsObject } from './response-definitions';
import { type SchemesListObject, parseSchemesListObject } from './schemes-list';
import { type SecurityDefinitionsObject, parseSecurityDefinitionsObject } from './security-definitions';
import { type SecurityObject, parseSecurityObject } from './security';
import { type TagObject, parseTagObject } from './tag';
import { validateArray } from '@amritk/helpers/validate-array';
import { isObject } from '@amritk/helpers/is-object';

/**
* Swagger object
*
* This is the root document object for the API specification. It combines what previously was the Resource Listing and API Declaration (version 1.2 and earlier) together into one document.
* 
* @see {@link https://swagger.io/specification/v2/#swagger-object}
*/
export type Document = {
  /** **Required.** Specifies the Swagger Specification version being used. It can be used by the Swagger UI and other clients to interpret the API listing. The value MUST be `"2.0"`. */
  swagger: "2.0";
  /** **Required.** Provides metadata about the API. The metadata can be used by the clients if needed. */
  info: InfoObject;
  /** The host (name or ip) serving the API. This MUST be the host only and does not include the scheme nor sub-paths. It MAY include a port. If the `host` is not included, the host serving the documentation is to be used (including the port). The `host` does not support [path templating](https://swagger.io/specification/v2/#path-templating). */
  host?: string;
  /** The base path on which the API is served, which is relative to the [`host`](https://swagger.io/specification/v2/#swaggerHost). If it is not included, the API is served directly under the `host`. The value MUST start with a leading slash (`/`). The `basePath` does not support [path templating](https://swagger.io/specification/v2/#path-templating). */
  basePath?: string;
  /** The transfer protocol of the API. Values MUST be from the list: `"http"`, `"https"`, `"ws"`, `"wss"`. If the `schemes` is not included, the default scheme to be used is the one used to access the Swagger definition itself. */
  schemes?: SchemesListObject;
  /** A list of MIME types the APIs can consume. This is global to all APIs but can be overridden on specific API calls. Value MUST be as described under [Mime Types](https://swagger.io/specification/v2/#mime-types). */
  consumes?: MediaTypeListObject;
  /** A list of MIME types the APIs can produce. This is global to all APIs but can be overridden on specific API calls. Value MUST be as described under [Mime Types](https://swagger.io/specification/v2/#mime-types). */
  produces?: MediaTypeListObject;
  /** **Required.** The available paths and operations for the API. */
  paths: PathsObject;
  /** An object to hold data types produced and consumed by operations. */
  definitions?: DefinitionsObject;
  /** An object to hold parameters that can be used across operations. This property *does not* define global parameters for all operations. */
  parameters?: ParameterDefinitionsObject;
  /** An object to hold responses that can be used across operations. This property *does not* define global responses for all operations. */
  responses?: ResponseDefinitionsObject;
  /** A declaration of which security schemes are applied for the API as a whole. The list of values describes alternative security schemes that can be used (that is, there is a logical OR between the security requirements). Individual operations can override this definition. */
  security?: SecurityObject;
  /** Security scheme definitions that can be used across the specification. */
  securityDefinitions?: SecurityDefinitionsObject;
  /** A list of tags used by the specification with additional metadata. The order of the tags can be used to reflect on their order by the parsing tools. Not all tags that are used by the [Operation Object](https://swagger.io/specification/v2/#operation-object) must be declared. The tags that are not declared may be organized randomly or based on the tools' logic. Each tag name in the list MUST be unique. */
  tags?: TagObject[];
  /** Additional external documentation. */
  externalDocs?: ExternalDocsObject;
};

export const parseDocument = (input: unknown): Document => {
  if (!isObject(input)) {
    return {} as unknown as Document;
  }
  const result = {
    ...input,
    swagger: typeof input?.swagger === "string" && ["2.0"].includes(input?.swagger as never) ? input?.swagger : (input?.swagger !== undefined ? String(input?.swagger) : "2.0"),
    info: parseInfoObject(input.info),
    ...((value => value === undefined ? {} : { host: value })(typeof input?.host === "string" && /^[^{}\/ :\\]+(?::\d+)?$/.test(input?.host) ? input?.host : (input?.host !== undefined ? String(input?.host) : undefined))),
    ...((value => value === undefined ? {} : { basePath: value })(typeof input?.basePath === "string" && /^\//.test(input?.basePath) ? input?.basePath : (input?.basePath !== undefined ? String(input?.basePath) : undefined))),
    ...(input.schemes && { schemes: parseSchemesListObject(input.schemes) }),
    ...((value => value === undefined ? {} : { consumes: value })(input?.consumes ?? undefined)),
    ...((value => value === undefined ? {} : { produces: value })(input?.produces ?? undefined)),
    paths: parsePathsObject(input.paths),
    ...(input.definitions && { definitions: parseDefinitionsObject(input.definitions) }),
    ...(input.parameters && { parameters: parseParameterDefinitionsObject(input.parameters) }),
    ...(input.responses && { responses: parseResponseDefinitionsObject(input.responses) }),
    ...(input.security && { security: parseSecurityObject(input.security) }),
    ...(input.securityDefinitions && { securityDefinitions: parseSecurityDefinitionsObject(input.securityDefinitions) }),
    ...(input.tags && { tags: validateArray(input.tags, parseTagObject) }),
    ...(input.externalDocs && { externalDocs: parseExternalDocsObject(input.externalDocs) }),
  } as unknown as Document;
  for (const key in input) {
    if (/^x-/.test(key)) {
      const value = input[key];
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
};