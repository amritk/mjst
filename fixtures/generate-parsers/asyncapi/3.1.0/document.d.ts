import type { Channels } from './channels.json';
import type { Components } from './components.json';
import type { Info } from './info.json';
import type { Operations } from './operations.json';
import type { Servers } from './servers.json';
export type Document = {
    /** A unique id representing the application. */
    id?: string;
    /** The AsyncAPI specification version of this document. */
    asyncapi: "3.1.0";
    channels?: Channels.jsonObject;
    components?: Components.jsonObject;
    /** Default content type to use when encoding/decoding a message's payload. */
    defaultContentType?: string;
    info: Info.jsonObject;
    operations?: Operations.jsonObject;
    servers?: Servers.jsonObject;
};
