export type InfoObject = {
    title: string;
    description?: string;
    contact?: unknown;
    externalDocs?: unknown | unknown;
    license?: unknown;
    tags?: (unknown | unknown)[];
    termsOfService?: string;
    version: string;
} & unknown;
