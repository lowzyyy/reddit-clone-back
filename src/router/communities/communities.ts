import fs from "fs/promises";
import path from "path";
import express from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import {
  extractAuthToken,
  processError,
  verifyUser,
} from "../../helpers/globalHelpers.js";
import { pool } from "../../db/dbController.js";
import { uploadMiddleware } from "./helpers.js";

export const communitiesRouter = express.Router();

const transformCommunity = (com: any) => {
  const { owner_id, visibility, ...community } = com;
  return community;
};

// get joined communities of authenticated user
communitiesRouter.get("/getJoinedCommunities", async (req, res) => {
  const token = extractAuthToken(req.headers.authorization);
  try {
    const user = await verifyUser(token);
    const userData = await pool.query(
      `select joined_communities from users where id=$1`,
      [user.userId]
    );
    return res.status(200).json({ data: userData.rows[0].joined_communities });
  } catch (error: any) {
    processError(error, res, null);
  }
});

// get searched communities
communitiesRouter.get("/communities", async (req, res) => {
  const { term } = req.query;
  const token = extractAuthToken(req.headers.authorization);
  // not auth user request
  if (!token) {
    try {
      if (!term) throw { message: "No action", code: 200 };
      const data = await pool.query(
        `SELECT * from communities WHERE strpos(lower(name), $1) > 0 and visibility = true`,
        [term]
      );
      return res.status(200).json({ data: data.rows.map(transformCommunity) });
    } catch (error) {
      processError(error, res, null);
    }
  } else {
    // auth user request
    try {
      const user = jwt.verify(token, process.env.jwt_secret!) as JwtPayload;
      if (!user) throw { message: "Not authenticated!", code: 401 };
      const data = await pool.query(
        `SELECT * from communities WHERE strpos(lower(name), $1) > 0 and visibility = true or (strpos(lower(name), $1) > 0 and visibility = false and owner_id=$2)`,
        [term, user.userId]
      );
      return res.status(200).json({ data: data.rows.map(transformCommunity) });
    } catch (error) {
      processError(error, res, null);
    }
  }
});

// get info about one community
communitiesRouter.get("/getCommunity", async (req, res) => {
  const { term } = req.query;
  const token = extractAuthToken(req.headers.authorization);
  try {
    if (!term) throw { message: "No action", code: 200 };
    // check if wanted community even exist
    const data = await pool.query(`select * from communities where name = $1`, [
      term,
    ]);
    if (data.rowCount === 0)
      throw { message: "Community does not exist!", code: 404 };
    const visibility = data.rows[0].visibility;
    const owner_id = data.rows[0].owner_id;
    // not auth user request
    if (!token) {
      if (!visibility) throw { message: "Community is private!", code: 403 };
      return res
        .status(200)
        .json({ data: data.rows.map(transformCommunity)[0] });
    } else {
      // auth user request
      const user = jwt.verify(token, process.env.jwt_secret!) as JwtPayload;
      // search for private community and he is not the owner -> forbidden
      if (!visibility && owner_id !== user.userId)
        throw { message: "Community is private!", code: 403 };
      else {
        // other cases
        const joinedData = await pool.query(
          `select * from users where id=$1 and $2 = ANY(joined_communities)`,
          [user.userId, term]
        );
        let isJoined = false;
        if (joinedData.rowCount > 0) isJoined = true;
        const { owner_id, ...community } = data.rows[0];
        return res.status(200).json({
          data: community,
          isOwner: owner_id === user.userId,
          isJoined,
        });
      }
    }
  } catch (error) {
    return processError(error, res, null);
  }
});

// create new community
communitiesRouter.post("/createCommunity", async (req, res) => {
  const { communityData } = req.body;
  const token = extractAuthToken(req.headers.authorization);
  try {
    const user = await verifyUser(token);
    if (!communityData.name || !communityData.visibility)
      throw { message: "Name or visibility missing!", code: 401 };

    const ifCommunityExist = (
      await pool.query(`select * from communities where name=$1`, [
        communityData.name,
      ])
    ).rowCount;
    if (ifCommunityExist)
      throw { message: "Community already exists!", code: 200 };
    await pool.query(`insert into communities values ($1,$2,$3,$4,$5,$6)`, [
      communityData.name,
      user.userId,
      0,
      communityData.visibility,
      new Date().getTime(),
      communityData.description ?? "",
    ]);
    return res.status(200).json({ message: "Success!" });
  } catch (error: any) {
    processError(error, res);
  }
});

communitiesRouter.post("/joinCommunity", async (req, res) => {
  const { term } = req.query;
  const token = extractAuthToken(req.headers.authorization);
  const client = await pool.connect();
  try {
    if (!term) throw { message: "No action", code: 200 };
    const user = await verifyUser(token);
    const communityResult = await pool.query(
      `select visibility,owner_id from communities where name=$1`,
      [term]
    );
    if (communityResult.rowCount === 0)
      throw { message: "Community does not exist!", code: 404 };
    const visibility = communityResult.rows[0].visibility;
    if (!visibility && user.userId !== communityResult.rows[0].owner_id)
      throw { message: "Community is private!", code: 403 };
    else {
      await client.query("BEGIN");
      await client.query(
        `update users set joined_communities = array_append(joined_communities, $2) where id = $1`,
        [user.userId, term]
      );
      await client.query(
        `update communities set members=members+1 where name=$1`,
        [term]
      );
      await client.query("COMMIT");
      client.release();
      return res.status(200).json("Success join!");
    }
  } catch (error: any) {
    await client.query("ROLLBACK");
    client.release();
    processError(error, res);
  }
});

communitiesRouter.post("/leaveCommunity", async (req, res) => {
  const { term } = req.query;
  const token = extractAuthToken(req.headers.authorization);
  const client = await pool.connect();
  try {
    if (!term) throw { message: "No action", code: 200 };
    const user = await verifyUser(token);
    await client.query("BEGIN");
    await client.query(
      `update users set joined_communities = array_remove(joined_communities, $2) where id = $1`,
      [user.userId, term]
    );
    await client.query(
      `update communities set members=members-1 where name=$1`,
      [term]
    );
    await client.query("COMMIT");
    client.release();
    return res.status(200).json("Success leave!");
  } catch (error: any) {
    await client.query("ROLLBACK");
    client.release();
    processError(error, res);
  }
});

communitiesRouter.post("/changeSettingsCommunity", async (req, res) => {
  const { term } = req.query;
  const { settings } = req.body;
  const token = extractAuthToken(req.headers.authorization);

  try {
    const user = await verifyUser(token);
    if (!settings) throw { message: "No action", code: 200 };
    if (!term) throw { message: "No action", code: 200 };
    const communityResult = await pool.query(
      `select visibility,owner_id from communities where name=$1`,
      [term]
    );
    if (communityResult.rowCount === 0)
      throw { message: "Community does not exist!", code: 404 };
    if (user.userId !== communityResult.rows[0].owner_id)
      throw { message: "Not authorized!", code: 403 };

    if (
      settings.visibility !== undefined &&
      settings.description !== undefined
    ) {
      await pool.query(
        `UPDATE communities SET visibility=$1,description=$2 where name=$3`,
        [settings.visibility, settings.description, term]
      );
    }
    if (settings.bannerHeight) {
      if (
        settings.bannerHeight !== "small" &&
        settings.bannerHeight !== "medium" &&
        settings.bannerHeight !== "large"
      )
        throw {
          message: "Incorrect banner size (small/medium/large)!",
          code: 400,
        };
      await pool.query(
        `UPDATE communities SET "bannerHeight"=$2 where name=$1`,
        [term, settings.bannerHeight]
      );
    }
    if (settings.bannerPosition) {
      const parsedBannerPosition = +settings.bannerPosition;
      if (
        !parsedBannerPosition ||
        parsedBannerPosition < 0 ||
        parsedBannerPosition > 100
      )
        throw {
          message: "Banner position must be number between 0-100!",
          code: 400,
        };
      await pool.query(
        `UPDATE communities SET "bannerPositionY"=$2 where name=$1`,
        [term, parsedBannerPosition]
      );
    }
    res.status(200).json({ message: "Success!" });
  } catch (error: any) {
    console.log(error);

    processError(error, res);
  }
});

communitiesRouter.post(
  "/setCommunityImage",
  uploadMiddleware,
  async (req, res) => {
    try {
      return res.status(200).json({ message: "Success upload" });
    } catch (error) {
      console.log(error);
    }
  }
);

communitiesRouter.get("/getCommunityImage", async (req, res) => {
  const { term, type } = req.query;
  try {
    if (!term) throw { message: "No action", code: 200 };
    if (type !== "banner" && type !== "icon")
      throw { message: "Available types: icon/banner!", code: 400 };
    const communityResult = await pool.query(
      `select visibility,owner_id from communities where name=$1`,
      [term]
    );
    if (communityResult.rowCount === 0)
      throw { message: "Community does not exist!", code: 404 };

    const img = (
      await fs.readdir(`${process.env.STARTPATHIMG}/communityImages`)
    ).filter(
      (img) => img.includes(term as string) && img.includes(type + ".webp")
    )[0];
    if (img === undefined) return res.status(404).send(null);

    return res
      .status(200)
      .sendFile(
        path.resolve(`${process.env.STARTPATHIMG}/communityImages/${img}`)
      );
  } catch (error) {}
});
