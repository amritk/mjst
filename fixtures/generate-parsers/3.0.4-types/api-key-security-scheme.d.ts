export type APIKeySecuritySchemeObject = {
    type: "apiKey";
    name: string;
    in: "header" | "query" | "cookie";
    description?: string;
};
