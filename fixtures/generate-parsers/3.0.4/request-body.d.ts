import type { MediaTypeObject } from './media-type';
export type RequestBodyObject = {
    description?: string;
    content: Record<string, MediaTypeObject>;
    required?: boolean;
};
