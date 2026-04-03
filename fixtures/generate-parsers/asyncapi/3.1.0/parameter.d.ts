export type ParameterObject = {
    /** A brief description of the parameter. This could contain examples of use. GitHub Flavored Markdown is allowed. */
    description?: string;
    /** An array of examples of the parameter value. */
    examples?: string[];
    /** The default value to use for substitution, and to send, if an alternate value is not supplied. */
    default?: string;
    /** An enumeration of string values to be used if the substitution options are from a limited set. */
    enum?: string[];
    /** A runtime expression that specifies the location of the parameter value */
    location?: string;
};
