import { type ContactObject, parseContactObject } from './contact';
import { type LicenseObject, parseLicenseObject } from './license';
import { isObject } from '@amritk/helpers/is-object';

/**
* Info object
*
* The object provides metadata about the API. The metadata can be used by the clients if needed, and can be presented in the Swagger-UI for convenience.
* 
* @see {@link https://swagger.io/specification/v2/#info-object}
*/
export type InfoObject = {
  /** **Required.** The title of the application. */
  title: string;
  /** **Required** Provides the version of the application API (not to be confused with the specification version). */
  version: string;
  /** A short description of the application. [GFM syntax](https://guides.github.com/features/mastering-markdown/#GitHub-flavored-markdown) can be used for rich text representation. */
  description?: string;
  /** The Terms of Service for the API. */
  termsOfService?: string;
  /** The contact information for the exposed API. */
  contact?: ContactObject;
  /** The license information for the exposed API. */
  license?: LicenseObject;
};

export const parseInfoObject = (input: unknown): InfoObject => {
  if (!isObject(input)) {
    return {} as unknown as InfoObject;
  }
  const result = {
    ...input,
    title: typeof input?.title === "string" ? input?.title : (input?.title !== undefined ? String(input?.title) : ""),
    version: typeof input?.version === "string" ? input?.version : (input?.version !== undefined ? String(input?.version) : ""),
    ...((value => value === undefined ? {} : { description: value })(typeof input?.description === "string" ? input?.description : (input?.description !== undefined ? String(input?.description) : undefined))),
    ...((value => value === undefined ? {} : { termsOfService: value })(typeof input?.termsOfService === "string" ? input?.termsOfService : (input?.termsOfService !== undefined ? String(input?.termsOfService) : undefined))),
    ...(input.contact && { contact: parseContactObject(input.contact) }),
    ...(input.license && { license: parseLicenseObject(input.license) }),
  } as unknown as InfoObject;
  for (const key in input) {
    if (/^x-/.test(key)) {
      const value = input[key];
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
};