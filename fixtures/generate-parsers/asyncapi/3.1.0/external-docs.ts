export type ExternalDocsObject = {
  /** A short description of the target documentation. CommonMark syntax can be used for rich text representation. */
  description?: string;
  /** The URL for the target documentation. This MUST be in the form of an absolute URL. */
  url: string;
};