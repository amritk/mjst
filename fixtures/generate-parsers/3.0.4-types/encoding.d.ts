import type { HeaderObject } from './header';
import type { ReferenceObject } from './reference';
export type EncodingObject = {
    contentType?: string;
    headers?: Record<string, HeaderObject | ReferenceObject>;
    style?: "form" | "spaceDelimited" | "pipeDelimited" | "deepObject";
    explode?: boolean;
    allowReserved?: boolean;
};
