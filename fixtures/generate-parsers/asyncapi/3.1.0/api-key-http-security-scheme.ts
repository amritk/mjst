export type ApiKeyHttpSecuritySchemeObject = {
  /** A short description for security scheme. CommonMark syntax MAY be used for rich text representation. */
  description?: string;
  /** The type of the security scheme. */
  type: "httpApiKey";
  /** The location of the API key */
  in: "header" | "query" | "cookie";
  /** The name of the header, query or cookie parameter to be used. */
  name: string;
};