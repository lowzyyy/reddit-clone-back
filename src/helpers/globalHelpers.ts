import { Response } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

export const extractAuthToken = (bearerString: string | undefined) => {
  const substr = bearerString
    ? bearerString.substring("Bearer ".length)
    : undefined;
  return substr !== "undefined" ? substr : undefined;
};

export const verifyUser = async (token: string | undefined) => {
  let user;
  if (!token) throw { message: "Not authorized!", code: 403 };
  try {
    user = jwt.verify(token, process.env.jwt_secret!) as JwtPayload;
  } catch (error) {
    throw { message: "Invalid token!!!", code: 404 };
  }
  return user;
};

export const processError = (error: any, res: Response, data?: null) => {
  if (data === undefined)
    return res.status(error.code || 404).json({ message: error.message });
  else
    return res
      .status(error.code || 404)
      .json({ data: null, message: error.message });
};
