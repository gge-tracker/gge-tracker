export const ApiUndefinedInputType = Symbol('ApiUndefinedInputType');
export const ApiInvalidInputType = Symbol('ApiInvalidInputType');

export type ApiUndefinedInputType = typeof ApiUndefinedInputType;
export type ApiInvalidInputType = typeof ApiInvalidInputType;
export type ApiInputErrorType = ApiUndefinedInputType | ApiInvalidInputType;
export type ApiValidStringType = string;
