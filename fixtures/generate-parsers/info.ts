import { type ContactObject, parseContactObject } from './contact';
import { type LicenseObject, parseLicenseObject } from './license';
import { isObject } from 'mjst-helpers/is-object';

export type InfoObject = {
  title: string;
  summary?: string;
  description?: string;
  termsOfService?: string;
  contact?: ContactObject;
  license?: LicenseObject;
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