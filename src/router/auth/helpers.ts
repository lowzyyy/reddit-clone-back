import { NextFunction, Request, Response } from "express";
import { pool } from "../../db/dbController.js";
import {
  extractAuthToken,
  processError,
  verifyUser,
} from "@/helpers/globalHelpers.js";
import { deleteAllImages } from "../communities/helpers.js";
import { fileFilter } from "../communities/helpers.js";
import multer from "multer";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const checkExistingUsername = async (username: string) => {
  const userExist = await pool.query(
    `select * from users where username = $1`,
    [username]
  );
  // already exists
  if (userExist.rows.length !== 0) return true;
  else return false;
};

export const checkExistingEmail = async (email: string) => {
  const userExist = await pool.query(`select * from users where email = $1`, [
    email,
  ]);
  // already exists
  if (userExist.rows.length !== 0) return true;
  else return false;
};

export const getVotedPosts = async (userId: string) => {
  try {
    const votedPosts = (
      await pool.query<{ post_id: string; voted: boolean }>(
        `select post_id,voted from voted_posts where user_id=$1`,
        [userId]
      )
    ).rows;

    const all_votes = votedPosts.reduce((acc, curr) => {
      return { ...acc, [curr.post_id]: curr.voted };
    }, {});

    return all_votes;
  } catch (error) {
    console.log(error);
  }
};

export const getVotedComments = async (userId: string) => {
  try {
    const votedComments = (
      await pool.query<{
        comment_id: string;
        voted: boolean;
      }>(`select comment_id,voted from voted_comments where user_id=$1`, [
        userId,
      ])
    ).rows;

    const all_votes = votedComments.reduce((acc, curr) => {
      return { ...acc, [curr.comment_id]: curr.voted };
    }, {});

    return all_votes;
  } catch (error) {
    console.log(error);
  }
};

const storage = multer.diskStorage({
  destination: path.join(__dirname, `${process.env.SAVEPATHIMG}/users/`),
  filename: async (req, file, cb) => {
    const userId = (
      await verifyUser(extractAuthToken(req.headers.authorization))
    ).userId;

    const ext = file.originalname.split(".")[1];
    cb(null, userId + "." + ext);
  },
});

const multerUpload = multer({ storage, fileFilter }).single("image");
export const uploadMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { shouldDelete, type } = req.query;
  const token = extractAuthToken(req.headers.authorization);
  try {
    if (type !== "avatar")
      throw { message: "Available types: avatar!", code: 400 };
    const user = await verifyUser(token);
    const userResult = await pool.query(`select id from users where id=$1`, [
      user.userId,
    ]);
    if (userResult.rowCount === 0)
      throw { message: "User does not exist!", code: 404 };

    if (shouldDelete && shouldDelete === "true") {
      await pool.query(`UPDATE users set have_avatar=false where id=$1`, [
        user.userId,
      ]);
      await deleteAllImages(
        `${process.env.STARTPATHIMG}/users`,
        user.userId,
        type
      );
      return res.status(200).json({ message: "Success delete" });
    }

    multerUpload(req, res, async (err) => {
      try {
        if (req.file) {
          await pool.query(`UPDATE users set have_avatar=true where id=$1`, [
            user.userId,
          ]);
          next();
        } else
          throw {
            message: "Error: available ext jpg/jpeg/png",
            code: 400,
          };
      } catch (error) {
        if (err) console.log(err);
        processError(error, res);
      }
    });
  } catch (error) {
    processError(error, res);
  }
};
