import { type TypeApikeyObject, parseTypeApikeyObject } from './type-apikey';
import { type TypeHttpBearerObject, parseTypeHttpBearerObject } from './type-http-bearer';
import { type TypeHttpObject, parseTypeHttpObject } from './type-http';
import { type TypeOauth2Object, parseTypeOauth2Object } from './type-oauth2';
import { type TypeOidcObject, parseTypeOidcObject } from './type-oidc';
import { isObject } from 'mjst-helpers/is-object';

export type SecuritySchemeObject = TypeApikeyObject | TypeHttpObject | TypeHttpBearerObject | TypeOauth2Object | TypeOidcObject;

export const parseSecuritySchemeObject = (input: unknown): SecuritySchemeObject => {
  if (!isObject(input)) {
    return parseTypeApikeyObject(input);
  }

  const parsedSubtype: SecuritySchemeObject = (() => {
    switch (input["type"]) {
    case "apiKey":
      return parseTypeApikeyObject(input);
    case "http":
      if (typeof input["scheme"] === "string" && /^[Bb][Ee][Aa][Rr][Ee][Rr]$/.test(input["scheme"])) {
        return parseTypeHttpBearerObject(input);
      }
      return parseTypeHttpObject(input);
    case "oauth2":
      return parseTypeOauth2Object(input);
    case "openIdConnect":
      return parseTypeOidcObject(input);
    default:
      return parseTypeApikeyObject(input);
    }
  })();

  return {
    ...input,
    ...((value => value === undefined ? {} : { description: value })(typeof input?.["description"] === "string" ? input?.["description"] : (input?.["description"] !== undefined ? String(input?.["description"]) : undefined))),
    ...parsedSubtype,
  };
};