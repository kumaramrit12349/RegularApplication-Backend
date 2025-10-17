import { IErrorWithDetails } from "../@types/auth";

// src/utils/errorUtils.ts
export const INTERNAL_SERVER_ERROR = 500;
export const BAD_REQUEST = 400;
export const BAD_REQUEST_NAME = "BadRequest";
export const SERVER_ERROR = "Internal Server Error";
export const INVALID_INPUT = "Invalid input data";

export function createThrowError(
  code: number,
  name: string,
  message: string,
  details: object
): never {
  const error: IErrorWithDetails = new Error(message);
  error.code = code;
  error.name = name;
  error.details = details;
  throw error;
}

export function logErrorLocation(
  fileName: string,
  method: string,
  error: any,
  message: string,
  learnerSK: string,
  params: any
) {
  const logErrorObject = {
    date: new Date().toISOString().slice(0, 20),
    Time: new Date().getTime(),
    fileName,
    method,
    error,
    message,
    learnerSK,
    errrCode: error.code,
    trace:error.stack,
    url: params?.req?.originalUrl,
    ip: params?.req?.ip,
    params: JSON.stringify({
      body: params?.req?.body,
      headers: params?.req?.headers,
      params: params?.req?.params,
      other: params?.req ? {} : params, // for other parameters
    }),
  };
  console.log(logErrorObject);
}
