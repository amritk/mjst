import type { ComponentsObject } from './components';
import type { ExternalDocumentationObject } from './external-documentation';
import type { InfoObject } from './info';
import type { PathsObject } from './paths';
import type { SecurityRequirementObject } from './security-requirement';
import type { ServerObject } from './server';
import type { TagObject } from './tag';
export type Document = {
    openapi: string;
    info: InfoObject;
    externalDocs?: ExternalDocumentationObject;
    servers?: ServerObject[];
    security?: SecurityRequirementObject[];
    tags?: TagObject[];
    paths: PathsObject;
    components?: ComponentsObject;
};
