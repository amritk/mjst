import { isObject } from 'mjst-helpers/is-object';

export type TypeOidcObject = {
  type: "openIdConnect";
  openIdConnectUrl: string;
};

export const parseTypeOidcObject = (input: unknown): TypeOidcObject => {
  if (!isObject(input)) return {} as TypeOidcObject;
  return {
    ...input,
    type: input?.type === "openIdConnect" ? input?.type : "openIdConnect",
    openIdConnectUrl: typeof input?.openIdConnectUrl === "string" ? input?.openIdConnectUrl : (input?.openIdConnectUrl !== undefined ? String(input?.openIdConnectUrl) : ""),
  } as unknown as TypeOidcObject;
}