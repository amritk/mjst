import type { ExternalDocumentationObject } from './external-documentation';
export type TagObject = {
    name: string;
    description?: string;
    externalDocs?: ExternalDocumentationObject;
};
