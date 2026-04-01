import { isObject } from 'mjst-helpers/is-object';

export type TypeOidcObject = {
  type: "openIdConnect";
  openIdConnectUrl: string;
};

export const parseTypeOidcObject = (input: unknown): TypeOidcObject => {
  if (!isObject(input)) return {
        openIdConnectUrl: "",
      };
  return {
    ...input,
    ...(input.type !== undefined && { type: input?.type === "openIdConnect" ? input?.type : "openIdConnect" }),
    openIdConnectUrl: typeof input?.openIdConnectUrl === "string" ? input?.openIdConnectUrl : (input?.openIdConnectUrl !== undefined ? String(input?.openIdConnectUrl) : ""),
  };
}