// src/routes/auth.ts
import { Router, Request, Response } from "express";
import { registerUser } from "../services/authService";
import {
  IResponse,
  ISignUpRes,
  RegisterRequest,
  IErrorWithDetails,
} from "../@types/auth";

const router = Router();

router.post("/register", async (req: Request, res: Response) => {
  const data: RegisterRequest = req.body;

  try {
    const success = await registerUser(data);

     const resData: IResponse<ISignUpRes> = {
      status: 200,
      message: 'Success',
      data: {  }, // boolean as expected
    };
    res.status(200).json(resData);
  } catch (err: unknown) {
    const error = err as IErrorWithDetails;
    const errData: IResponse<ISignUpRes> = {
      status: error.code || 400,
      message: error.message || "Registration failed",
      data: {
        failure: {
          email: error.details?.email || data.email,
        },
      },
    };
    res.status(errData.status).json(errData);
  }
});

export default router;
