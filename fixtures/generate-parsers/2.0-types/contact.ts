import type { VendorExtensionObject } from './vendor-extension';

export type ContactObject = {
  /** The identifying name of the contact person/organization. */
  name?: string;
  /** The URL pointing to the contact information. */
  url?: string;
  /** The email address of the contact person/organization. */
  email?: string;
};