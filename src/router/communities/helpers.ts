import { pool } from "@/db/dbController.js";
import {
  extractAuthToken,
  processError,
  verifyUser,
} from "@/helpers/globalHelpers.js";
import { NextFunction, Request, Response } from "express";
import fs from "fs/promises";
import multer from "multer";
import path, { dirname } from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const deleteAllImages = async (
  pathOfFiles: string,
  name: string,
  type: "icon" | "banner" | "avatar"
) => {
  const files = await fs.readdir(`${pathOfFiles}`);
  await Promise.all(
    files
      .filter((img) => {
        if (type === "avatar") return img.includes(name);
        else return img.includes(name) && img.includes(type);
      })
      .map(async (img) => {
        const imgPath = path.resolve(`${pathOfFiles}/${img}`);
        await fs.unlink(imgPath);
      })
  );
};

export const fileFilter = async (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  if (
    file.mimetype === "image/png" ||
    file.mimetype === "image/jpg" ||
    file.mimetype === "image/jpeg"
  ) {
    if (req.query.type === "banner" || req.query.type === "icon")
      await deleteAllImages(
        `${process.env.STARTPATHIMG}/communityImages`,
        req.query.term as string,
        req.query.type
      );
    if (req.query.type === "avatar") {
      const userId = (
        await verifyUser(extractAuthToken(req.headers.authorization))
      ).userId;
      await deleteAllImages(
        `${process.env.STARTPATHIMG}/users`,
        userId,
        req.query.type
      );
    }
    cb(null, true);
  } else {
    cb(null, false);
  }
};

const storage = multer.diskStorage({
  destination: path.join(
    __dirname,
    `${process.env.SAVEPATHIMG}/communityImages/`
  ),
  filename: (req, file, cb) => {
    const ext = file.originalname.split(".")[1];
    cb(null, req.query.term + "_" + req.query.type + "." + ext.toLowerCase());
  },
});

const multerUpload = multer({ storage, fileFilter }).single("image");

export const uploadMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { term, shouldDelete, type } = req.query;
  const token = extractAuthToken(req.headers.authorization);
  try {
    if (!term) throw { message: "No action", code: 200 };
    if (type !== "banner" && type !== "icon")
      throw { message: "Available types: icon/banner!", code: 400 };
    const user = await verifyUser(token);
    const communityResult = await pool.query(
      `select owner_id from communities where name=$1`,
      [term]
    );
    if (communityResult.rowCount === 0)
      throw { message: "Community does not exist!", code: 404 };
    if (user.userId !== communityResult.rows[0].owner_id)
      throw { message: "Not authorized!", code: 403 };

    if (shouldDelete && shouldDelete === "true") {
      await deleteAllImages(
        `${process.env.STARTPATHIMG}/communityImages`,
        req.query.term as string,
        type
      );
      return res.status(200).json({ message: "Success delete" });
    }
    // run multer if everything before was ok and then call next with file attached to req
    multerUpload(req, res, async (err) => {
      try {
        if (req.file) {
          await sharp(req.file!.path)
            .webp({ quality: 50 })
            .withMetadata()
            .rotate()
            .toFile(req.file!.path.split(".")[0] + ".webp");
          await fs.unlink(req.file.path);
          next();
        } else
          throw {
            message: "Error: available ext jpg/jpeg/png",
            code: 400,
          };
      } catch (error) {
        console.log(error);

        processError(error, res);
      }
    });
  } catch (error) {
    processError(error, res);
  }
};
