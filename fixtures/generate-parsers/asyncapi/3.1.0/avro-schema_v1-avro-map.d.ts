import type { AvroSchema_v1NameObject } from './avro-schema_v1-name';
import type { AvroSchema_v1NamespaceObject } from './avro-schema_v1-namespace';
import type { AvroSchema_v1TypesObject } from './avro-schema_v1-types';
export type AvroSchema_v1AvroMapObject = {
    type: "map";
    name?: AvroSchema_v1NameObject;
    namespace?: AvroSchema_v1NamespaceObject;
    doc?: string;
    aliases?: AvroSchema_v1NameObject[];
    values: AvroSchema_v1TypesObject;
};
