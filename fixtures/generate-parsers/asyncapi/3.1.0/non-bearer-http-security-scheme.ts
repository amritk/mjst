export type NonBearerHttpSecuritySchemeObject = {
  /** A short description for security scheme. */
  description?: string;
  /** The type of the security scheme. */
  type: "http";
  /** The name of the HTTP Authorization scheme to be used in the Authorization header as defined in RFC7235. */
  scheme: string;
};