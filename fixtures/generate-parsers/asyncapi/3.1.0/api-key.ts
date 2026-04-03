export type ApiKeyObject = {
  /** A short description for security scheme. CommonMark syntax MAY be used for rich text representation. */
  description?: string;
  /** The type of the security scheme */
  type: "apiKey";
  /**  The location of the API key. */
  in: "user" | "password";
};