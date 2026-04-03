import type { AvroSchema_v1NameObject } from './avro-schema_v1-name';
import type { AvroSchema_v1TypesObject } from './avro-schema_v1-types';
export type AvroSchema_v1AvroFieldObject = {
    name: AvroSchema_v1NameObject;
    type: AvroSchema_v1TypesObject;
    doc?: string;
    default?: boolean;
    order?: "ascending" | "descending" | "ignore";
    aliases?: AvroSchema_v1NameObject[];
};
