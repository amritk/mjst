import type { DefinitionsObject } from './definitions';
import type { ExternalDocsObject } from './external-docs';
import type { InfoObject } from './info';
import type { MediaTypeListObject } from './media-type-list';
import type { ParameterDefinitionsObject } from './parameter-definitions';
import type { PathsObject } from './paths';
import type { ResponseDefinitionsObject } from './response-definitions';
import type { SchemesListObject } from './schemes-list';
import type { SecurityDefinitionsObject } from './security-definitions';
import type { SecurityObject } from './security';
import type { TagObject } from './tag';
export type Document = {
    /** The Swagger version of this document. */
    swagger: "2.0";
    info: InfoObject;
    /** The host (name or ip) of the API. Example: 'swagger.io' */
    host?: string;
    /** The base path to the API. Example: '/api'. */
    basePath?: string;
    schemes?: SchemesListObject;
    /** A list of MIME types accepted by the API. */
    consumes?: MediaTypeListObject;
    /** A list of MIME types the API can produce. */
    produces?: MediaTypeListObject;
    paths: PathsObject;
    definitions?: DefinitionsObject;
    parameters?: ParameterDefinitionsObject;
    responses?: ResponseDefinitionsObject;
    security?: SecurityObject;
    securityDefinitions?: SecurityDefinitionsObject;
    tags?: TagObject[];
    externalDocs?: ExternalDocsObject;
};
