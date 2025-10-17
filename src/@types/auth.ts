// src/@types/auth.ts
export interface RegisterRequest {
  email: string;
  password: string;
  given_name: string;
  family_name: string;
  gender: string;
}

export interface IResponse<T> {
  status: number;
  message: string;
  data: T;
}

export interface ISignUpRes {
  success?: boolean;
  failure?: {
    email?: string;
  };
}

export interface IErrorWithDetails extends Error {
  code?: number;
  // make name non-optional and string matching Error interface
  name: string;
  details?: { email?: string };
}

