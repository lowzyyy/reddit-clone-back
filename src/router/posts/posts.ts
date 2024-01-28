import express from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { v4 as uuidv4, validate } from "uuid";
import {
  extractAuthToken,
  processError,
  verifyUser,
} from "../../helpers/globalHelpers.js";

import { pool } from "../../db/dbController.js";
import { getVotedPosts } from "../auth/helpers.js";
import {
  getTypeVotes,
  getVotedType,
  setTypeVote,
} from "../comments/helpers.js";

export const postsRouter = express.Router();

postsRouter.get("/getCommunityPost", async (req, res) => {
  const { postId } = req.query;
  try {
    if (!postId) throw { message: "No action!", code: 200 };
    if (!validate(postId as string))
      throw { message: "Invalid postId!", code: 400 };
    const postData = await pool.query(
      `select posts.*,username from posts join users on owner_id=users.id where posts.id = $1`,
      [postId]
    );
    if (postData.rowCount === 0)
      throw { message: "Post does not exist!", code: 404 };

    const community = postData.rows[0].community_id;
    const { visibility, owner_id } = (
      await pool.query(
        `select visibility,owner_id from communities where name=$1`,
        [community]
      )
    ).rows[0];

    let user;
    if (!visibility) {
      const token = extractAuthToken(req.headers.authorization);
      user = await verifyUser(token);
      if (owner_id !== user.userId)
        throw { message: "Community is private!", code: 403 };
    }
    const { num_comments: numOfComments } = (
      await pool.query(
        `select count(*) as num_comments from comments where post_id=$1`,
        [postId]
      )
    ).rows[0];
    const { owner_id: postOwner, ...post } = postData.rows[0];
    const isOwner = user ? user.userId === postOwner : false;
    return res.status(200).json({ data: { ...post, numOfComments }, isOwner });
  } catch (error) {
    processError(error, res, null);
  }
});

postsRouter.get("/getCommunityPosts", async (req, res) => {
  const { term } = req.query;
  try {
    if (!term) throw { message: "No action", code: 200 };
    const token = extractAuthToken(req.headers.authorization);
    if (!token) {
      const isValidCommunity =
        (
          await pool.query(
            `select * from communities where name=$1 and visibility=true `,
            [term]
          )
        ).rowCount > 0;
      if (!isValidCommunity) throw { message: "Invalid community", code: 403 };
    } else {
      const user = jwt.verify(token, process.env.jwt_secret!) as JwtPayload;
      const isValidCommunity =
        (
          await pool.query(
            `select * from communities where name=$1 and ((visibility=false and owner_id=$2) or visibility=true)`,
            [term, user.userId]
          )
        ).rowCount > 0;
      if (!isValidCommunity) throw { message: "Invalid community", code: 403 };
    }

    const postsData = await pool.query(
      `select posts.*,username,(select count(*) as "numOfComments" from comments where post_id=posts.id)  from users join posts on owner_id=users.id where community_id=$1 order by "createdAt" desc`,
      [term]
    );

    const posts = postsData.rows.map((el) => {
      const { owner_id, ...rest } = el;
      return rest;
    });
    return res.status(200).json({ data: posts });
  } catch (error: any) {
    processError(error, res, null);
  }
});

postsRouter.post("/createCommunityPost", async (req, res) => {
  const { term } = req.query;
  const { postData } = req.body;
  try {
    const token = extractAuthToken(req.headers.authorization);
    const user = await verifyUser(token);
    if (!postData) throw { message: "No action", code: 200 };
    else if (!postData.title || !postData.content)
      throw { message: "Title or content missing!", code: 400 };
    if (!term) throw { message: "No action", code: 200 };
    const isValidCommunity =
      (
        await pool.query(
          `select * from communities where name=$1 and ((visibility=false and owner_id=$2) or visibility=true)`,
          [term, user.userId]
        )
      ).rowCount > 0;
    if (!isValidCommunity) throw { message: "Invalid community", code: 403 };

    const postId = uuidv4();
    await pool.query(`insert into posts values ($1,$2,$3,$4,$5,$6,$7)`, [
      postId,
      term,
      new Date().getTime(),
      postData.content,
      user.userId,
      0,
      postData.title,
    ]);

    return res.status(200).json({ message: "Success!" });
  } catch (error: any) {
    processError(error, res, null);
  }
});

postsRouter.get("/getPostVotes", async (req, res) => {
  getTypeVotes(req, res, "posts");
});

postsRouter.post("/setPostVote", async (req, res) => {
  setTypeVote(req, res, "posts");
});

postsRouter.get("/getVotedPosts", async (req, res) => {
  getVotedType(req, res, "posts");
});

// for home page
postsRouter.get("/getAllPosts", async (req, res) => {
  const token = extractAuthToken(req.headers.authorization);
  try {
    let allPosts;
    let topCommunities;

    if (token) {
      const user = await verifyUser(token);
      allPosts = await pool.query(
        `select posts.*,username,(select count(*) as "numOfComments" from comments where post_id=posts.id)  
        from users join posts on owner_id=users.id 
        where community_id in (SELECT unnest((select joined_communities from users where id=$1)))
        order by "createdAt" desc`,
        [user.userId]
      );
    } else {
      allPosts = await pool.query(`
        select posts.*,username,(select count(*) as "numOfComments" from comments where post_id=posts.id)  
        from users join posts on owner_id=users.id 
        where community_id in (SELECT name from communities where visibility=true order by members desc limit 5)
        order by votes desc`);
      topCommunities = await pool.query(
        `select name,members from communities where visibility=true order by members desc limit 5`
      );
    }
    return res.status(200).json({
      data: allPosts.rows,
      topCommunities: token ? null : topCommunities?.rows,
    });
  } catch (error) {
    processError(error, res, null);
  }
});
