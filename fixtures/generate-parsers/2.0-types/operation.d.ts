import type { ExternalDocsObject } from './external-docs';
import type { MediaTypeListObject } from './media-type-list';
import type { ParametersListObject } from './parameters-list';
import type { ResponsesObject } from './responses';
import type { SchemesListObject } from './schemes-list';
import type { SecurityObject } from './security';
export type OperationObject = {
    tags?: string[];
    /** A brief summary of the operation. */
    summary?: string;
    /** A longer description of the operation, GitHub Flavored Markdown is allowed. */
    description?: string;
    externalDocs?: ExternalDocsObject;
    /** A unique identifier of the operation. */
    operationId?: string;
    /** A list of MIME types the API can produce. */
    produces?: MediaTypeListObject;
    /** A list of MIME types the API can consume. */
    consumes?: MediaTypeListObject;
    parameters?: ParametersListObject;
    responses: ResponsesObject;
    schemes?: SchemesListObject;
    deprecated?: boolean;
    security?: SecurityObject;
};
