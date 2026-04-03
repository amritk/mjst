import type { HeaderObject } from './header';
import type { LinkObject } from './link';
import type { MediaTypeObject } from './media-type';
import type { ReferenceObject } from './reference';
export type ResponseObject = {
    description: string;
    headers?: Record<string, HeaderObject | ReferenceObject>;
    content?: Record<string, MediaTypeObject>;
    links?: Record<string, LinkObject | ReferenceObject>;
};
