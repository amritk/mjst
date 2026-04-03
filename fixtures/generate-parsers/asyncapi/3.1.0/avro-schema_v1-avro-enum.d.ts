import type { AvroSchema_v1NameObject } from './avro-schema_v1-name';
import type { AvroSchema_v1NamespaceObject } from './avro-schema_v1-namespace';
export type AvroSchema_v1AvroEnumObject = {
    type: "enum";
    name: AvroSchema_v1NameObject;
    namespace?: AvroSchema_v1NamespaceObject;
    doc?: string;
    aliases?: AvroSchema_v1NameObject[];
    symbols: AvroSchema_v1NameObject[];
};
