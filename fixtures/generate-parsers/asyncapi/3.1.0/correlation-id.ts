export type CorrelationIdObject = {
  /** A optional description of the correlation ID. GitHub Flavored Markdown is allowed. */
  description?: string;
  /** A runtime expression that specifies the location of the correlation ID */
  location: string;
};