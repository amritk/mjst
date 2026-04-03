import type { ContactObject } from './contact';
import type { LicenseObject } from './license';
export type InfoObject = {
    /** A unique and precise title of the API. */
    title: string;
    /** A semantic version number of the API. */
    version: string;
    /** A longer description of the API. Should be different from the title.  GitHub Flavored Markdown is allowed. */
    description?: string;
    /** The terms of service for the API. */
    termsOfService?: string;
    contact?: ContactObject;
    license?: LicenseObject;
};
