export type ServerVariableObject = {
    /** An optional description for the server variable. CommonMark syntax MAY be used for rich text representation. */
    description?: string;
    /** An array of examples of the server variable. */
    examples?: string[];
    /** The default value to use for substitution, and to send, if an alternate value is not supplied. */
    default?: string;
    /** An enumeration of string values to be used if the substitution options are from a limited set. */
    enum?: string[];
};
