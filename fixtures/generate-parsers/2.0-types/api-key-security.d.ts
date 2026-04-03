export type ApiKeySecurityObject = {
    type: "apiKey";
    name: string;
    in: "header" | "query";
    description?: string;
};
