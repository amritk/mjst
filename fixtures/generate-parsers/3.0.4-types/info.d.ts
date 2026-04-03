import type { ContactObject } from './contact';
import type { LicenseObject } from './license';
export type InfoObject = {
    title: string;
    description?: string;
    termsOfService?: string;
    contact?: ContactObject;
    license?: LicenseObject;
    version: string;
};
