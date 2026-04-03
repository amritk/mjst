export type SaslScramSecuritySchemeObject = {
    /** A short description for security scheme. */
    description?: string;
    /** The type of the security scheme. */
    type: "scramSha256" | "scramSha512";
};
