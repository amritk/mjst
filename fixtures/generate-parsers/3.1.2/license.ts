import { isObject } from 'mjst-helpers/is-object';

/**
* License object
*
* License information for the exposed API.
* 
* @see {@link https://spec.openapis.org/oas/v3.1#license-object}
*/
export type LicenseObject = {
  /** **REQUIRED**. The license name used for the API. */
  name: string;
  /** An [SPDX](https://spdx.org/licenses/) license expression for the API. The `identifier` field is mutually exclusive of the `url` field. */
  identifier?: string;
  /** A URI for the license used for the API. This MUST be in the form of a URI. The `url` field is mutually exclusive of the `identifier` field. */
  url?: string;
} & Record<`x-${string}`, unknown>;

export const parseLicenseObject = (input: unknown): LicenseObject => {
  if (!isObject(input)) return {
        name: "",
      };
  const _name = input.name;
  const _identifier = input.identifier;
  const _url = input.url;
  if (typeof _name === "string" && (_identifier === undefined || typeof _identifier === "string") && (_url === undefined || typeof _url === "string")) return { ...input } as LicenseObject;
  return {
    ...input,
    name: typeof _name === "string" ? _name : (_name !== undefined ? String(_name) : ""),
    ...(_identifier !== undefined && { identifier: typeof _identifier === "string" ? _identifier : String(_identifier) }),
    ...(_url !== undefined && { url: typeof _url === "string" ? _url : String(_url) }),
  } as unknown as LicenseObject;
}