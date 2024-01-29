import express, { Response } from "express";
import { pool } from "../../db/dbController.js";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import jwt, { JwtPayload } from "jsonwebtoken";
import {
  extractAuthToken,
  processError,
  verifyUser,
} from "../../helpers/globalHelpers.js";
import {
  checkExistingEmail,
  checkExistingUsername,
  getVotedComments,
  getVotedPosts,
  uploadMiddleware,
} from "./helpers.js";
import multer from "multer";

const tokenExpireShort = 7_200_000; //2hour
// const tokenExpireShort = 30_000;
const tokenExpireLong = 604_800_000; //7days

export const authRouter = express.Router();

authRouter.post("/signup", multer().none(), async (req, res, next) => {
  const { username, email } = req.body;

  try {
    const userExist = await checkExistingUsername(username);
    if (userExist) throw { message: "User already exists!", code: 400 };
    const emailExist = await checkExistingEmail(email);
    if (emailExist)
      throw { message: "This email is already in use!", code: 400 };

    const userId = uuidv4();
    // get token
    const token = jwt.sign(
      { userId, email, username },
      process.env.jwt_secret!,
      {
        expiresIn: "2 hours",
      }
    );
    const linkToVerify = `${process.env.WEBSITEADDRESS}/auth/finishSignup?authtoken=${token}`;
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.MAILUSER,
        pass: process.env.MAILPASSWORD,
      },
    });
    await transporter.sendMail({
      to: email,
      from: process.env.MAILUSER,
      subject: "Please verify account",
      html: `Hi ${username},<br>
      follow the link to activate account and set a password:<br> <a href=${linkToVerify}>${linkToVerify}</a>`,
    });
    return res.status(200).json({ message: "Success!" });
  } catch (error: any) {
    processError(error, res);
  }
});

authRouter.post("/finishSignup", multer().none(), async (req, res) => {
  const { password, rememberMe } = req.body;
  console.log(req.body);

  const token = extractAuthToken(req.headers.authorization);
  try {
    const user = await verifyUser(token);
    const userExist = await checkExistingUsername(user.username);
    if (userExist) throw { message: "Account is activated!", code: 403 };
    const newToken = jwt.sign(
      { userId: user.userId, email: user.email, username: user.username },
      process.env.jwt_secret!,
      { expiresIn: `${rememberMe ? "7 days" : "2 hours"}` }
    );
    const passCrypted = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO users (id,username,email,password) VALUES ($1,$2,$3,$4)`,
      [user.userId, user.username, user.email, passCrypted]
    );
    // send token back
    const timeNow = new Date().getTime();
    const expiresIn =
      timeNow + (rememberMe ? tokenExpireLong : tokenExpireShort);

    return res.status(200).json({
      token: newToken,
      expiresIn,
      username: user.username,
    });
  } catch (error) {
    processError(error, res, null);
  }
});

authRouter.post("/login", multer().none(), async (req, res) => {
  const { username, password, rememberMe } = req.body;

  const oldToken = extractAuthToken(req.headers.authorization);
  // refresh token if token did not expire
  if (oldToken) {
    let user;
    try {
      user = await verifyUser(oldToken);
      const newToken = jwt.sign(
        { userId: user.userId, email: user.email, username: user.username },
        process.env.jwt_secret!,
        { expiresIn: `${rememberMe ? "7 days" : "2 hours"}` }
      );
      const have_avatar = (
        await pool.query(`select have_avatar from users where id=$1`, [
          user.userId,
        ])
      ).rows[0].have_avatar;

      const votedPosts = await getVotedPosts(user.userId);
      const votedComments = await getVotedComments(user.userId);
      const timeNow = new Date().getTime();
      const expiresIn =
        timeNow + (rememberMe ? tokenExpireLong : tokenExpireShort);
      return res.status(200).json({
        token: newToken,
        username: user.username,
        id: user.userId,
        have_avatar,
        expiresIn,
        votedPosts,
        votedComments,
      });
    } catch (error) {
      processError(error, res);
    }
  } else {
    // login normally if its normal login from the form
    try {
      // check if user with username actually exist
      const userExist = await checkExistingUsername(username);
      if (!userExist)
        throw {
          message: "User does not exist!",
          statusCode: 404,
        };
      // if exist get user information
      const userData = await pool.query(
        `select * from users where username=$1`,
        [username]
      );
      const isPasswordValid = await bcrypt.compare(
        password,
        userData.rows[0].password
      );
      if (!isPasswordValid)
        throw { message: "Invalid password!", statusCode: 401 };
      // if password is valid then login
      const token = jwt.sign(
        {
          userId: userData.rows[0].id,
          email: userData.rows[0].email,
          username: userData.rows[0].username,
        },
        process.env.jwt_secret!,
        { expiresIn: `${rememberMe ? tokenExpireLong : tokenExpireShort}` }
      );
      const votedPosts = await getVotedPosts(userData.rows[0].id);
      const votedComments = await getVotedComments(userData.rows[0].id);
      const timeNow = new Date().getTime();
      const expiresIn =
        timeNow + (rememberMe ? tokenExpireLong : tokenExpireShort);
      res.status(200).json({
        token,
        username,
        id: userData.rows[0].id,
        have_avatar: userData.rows[0].have_avatar,
        expiresIn,
        votedPosts,
        votedComments,
      });
    } catch (error: any) {
      processError(error, res);
    }
  }
});

authRouter.post("/setUserImage", uploadMiddleware, async (req, res) => {
  try {
    return res.status(200).json({ message: "Success upload avatar" });
    // return res.status(200).sendFile(req.file);
  } catch (error) {
    console.log(error);
  }
});

authRouter.post("/changePassword", multer().none(), async (req, res) => {
  const { password } = req.body;
  const token = extractAuthToken(req.headers.authorization);
  try {
    const user = await verifyUser(token);

    const passCrypted = await bcrypt.hash(password, 10);
    await pool.query(`UPDATE users set password = $1 where id=$2`, [
      passCrypted,
      user.userId,
    ]);
    return res.status(200).json({ message: "Success change password" });
  } catch (error) {
    processError(error, res);
  }
});

authRouter.post("/requestResetPassword", multer().none(), async (req, res) => {
  const { email } = req.body;

  try {
    const user = await pool.query(
      `select username,id from users where email=$1`,
      [email]
    );
    if (user.rowCount === 0)
      return res.status(200).json({ message: "Success!" });
    const { username, id: userId } = user.rows[0];
    const token = jwt.sign(
      { userId, email, username },
      process.env.jwt_secret!,
      {
        expiresIn: "2 hours",
      }
    );
    const linkToVerify = `${process.env.WEBSITEADDRESS}/auth/finishResetPassword?authtoken=${token}&username=${username}`;
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.MAILUSER,
        pass: process.env.MAILPASSWORD,
      },
    });
    await transporter.sendMail({
      to: email,
      from: process.env.MAILUSER,
      subject: "Request reset password",
      html: `Hi ${username},<br>
      follow the link to reset your account password and set a new password:<br> <a href=${linkToVerify}>${linkToVerify}</a>`,
    });
    return res.status(200).json({ message: "Success!" });
  } catch (error) {
    processError(error, res);
  }
});
