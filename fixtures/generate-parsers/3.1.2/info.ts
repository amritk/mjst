import { type ContactObject, parseContactObject } from './contact';
import { type LicenseObject, parseLicenseObject } from './license';
import { isObject } from '@amritk/helpers/is-object';

/**
* Info object
*
* The object provides metadata about the API. The metadata MAY be used by the clients if needed, and MAY be presented in editing or documentation generation tools for convenience.
* 
* @see {@link https://spec.openapis.org/oas/v3.1#info-object}
*/
export type InfoObject = {
  /** **REQUIRED**. The title of the API. */
  title: string;
  /** A short summary of the API. */
  summary?: string;
  /** A description of the API. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. */
  description?: string;
  /** A URI for the Terms of Service for the API. This MUST be in the form of a URI. */
  termsOfService?: string;
  /** The contact information for the exposed API. */
  contact?: ContactObject;
  /** The license information for the exposed API. */
  license?: LicenseObject;
  /** **REQUIRED**. The version of the OpenAPI Document (which is distinct from the [OpenAPI Specification version](https://spec.openapis.org/oas/v3.1#oas-version) or the version of the API being described or the version of the OpenAPI Description). */
  version: string;
} & Record<`x-${string}`, unknown>;

export const parseInfoObject = (input: unknown): InfoObject => {
  if (!isObject(input)) return {
        title: "",
        version: "",
      };
  const _contact = input.contact;
  const _license = input.license;
  return {
    ...input,
    title: typeof input?.title === "string" ? input?.title : (input?.title !== undefined ? String(input?.title) : ""),
    ...(input.summary !== undefined && { summary: typeof input?.summary === "string" ? input?.summary : String(input?.summary) }),
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
    ...(input.termsOfService !== undefined && { termsOfService: typeof input?.termsOfService === "string" ? input?.termsOfService : String(input?.termsOfService) }),
    ...(_contact !== undefined && { contact: parseContactObject(_contact) }),
    ...(_license !== undefined && { license: parseLicenseObject(_license) }),
    version: typeof input?.version === "string" ? input?.version : (input?.version !== undefined ? String(input?.version) : ""),
  } as unknown as InfoObject;
}