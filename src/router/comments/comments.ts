import express from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { v4 as uuidv4, validate } from "uuid";
import {
  extractAuthToken,
  processError,
  verifyUser,
} from "../../helpers/globalHelpers.js";
import { pool } from "../../db/dbController.js";
import {
  TComment,
  TSort,
  getSubComments,
  getTypeVotes,
  getVotedType,
  setTypeVote,
  validateSort,
} from "./helpers.js";
import { getVotedComments } from "../auth/helpers.js";

export const commentsRouter = express.Router();

export type TCommentRequest = {
  parentId: string | null | undefined;
  postId: string | undefined;
  content: string | undefined;
};

commentsRouter.post("/postComment", async (req, res) => {
  const commentData: TCommentRequest = req.body.commentData;
  try {
    const token = extractAuthToken(req.headers.authorization);
    const user = await verifyUser(token);
    if (
      !commentData.content ||
      commentData.parentId === undefined ||
      !commentData.postId
    )
      throw { message: "Not enough comment data!", code: 400 };

    if (!validate(commentData.postId))
      throw { message: "Invalid postid!", code: 400 };
    const isPostIdValid = await pool.query(`select * from posts where id=$1`, [
      commentData.postId,
    ]);
    if (isPostIdValid.rowCount === 0)
      throw { message: "Post does not exist!", code: 404 };

    if (commentData.parentId !== null) {
      if (!validate(commentData.parentId))
        throw { message: "Invalid parentid!", code: 400 };
      const isParentIdValid = await pool.query(
        `select * from comments where id=$1`,
        [commentData.parentId]
      );
      if (isParentIdValid.rowCount === 0)
        throw { message: "Parent comment does not exist!", code: 404 };
    }

    // if everything is ok then insert
    const id = uuidv4();
    await pool.query(`insert into comments values ($1,$2,$3,$4,$5,$6,$7)`, [
      id,
      commentData.parentId,
      commentData.postId,
      user.userId,
      commentData.content,
      new Date().getTime(),
      0,
    ]);
    return res.status(200).json({ message: "Success comment!" });
  } catch (error) {
    console.log(error);
    processError(error, res);
  }
});

commentsRouter.get("/getPostComments", async (req, res) => {
  let userId;
  try {
    const token = extractAuthToken(req.headers.authorization);
    if (!token) userId = null;
    else {
      const user = jwt.verify(token, process.env.jwt_secret!) as JwtPayload;
      userId = user.userId;
    }
  } catch (error) {
    processError({ message: "Invalid token!!!", code: 404 }, res, null);
    return;
  }

  try {
    const { postId, sortType } = req.query;
    let sort: TSort = sortType ? validateSort(sortType as string) : "top";
    if (!postId || postId === "undefined")
      throw { message: "No action!", code: 200 };
    if (!validate(postId as string))
      throw { message: "Invalid postid!", code: 400 };
    const isPostIdValid = await pool.query(`select * from posts where id=$1`, [
      postId,
    ]);
    if (isPostIdValid.rowCount === 0)
      throw { message: "Post does not exist!", code: 404 };

    const commentsData = await pool.query<TComment>(
      `select comments.*,username,have_avatar from comments join users on owner_id=users.id where post_id=$1`,
      [postId]
    );

    const comments = getSubComments(commentsData.rows, userId, sort);

    return res.status(200).json({ data: comments });
  } catch (error) {
    processError(error, res, null);
  }
});

commentsRouter.get("/getComment", async (req, res) => {
  let userId;
  try {
    const token = extractAuthToken(req.headers.authorization);
    if (!token) userId = null;
    else {
      const user = jwt.verify(token, process.env.jwt_secret!) as JwtPayload;
      userId = user.userId;
    }
  } catch (error) {
    processError({ message: "Invalid token!!!", code: 404 }, res, null);
    return;
  }

  try {
    const { commentId, sortType } = req.query;
    let sort: TSort = sortType ? validateSort(sortType as string) : "top";
    if (!commentId || commentId === "undefined")
      throw { message: "No action!", code: 200 };
    if (!validate(commentId as string))
      throw { message: "Invalid commentid!", code: 400 };
    const isCommentIdValid = await pool.query(
      `select * from comments where id=$1`,
      [commentId]
    );
    if (isCommentIdValid.rowCount === 0)
      throw { message: "Comment does not exist!", code: 404 };

    const commentsData = await pool.query<TComment>(
      `with recursive post_comm as (
        select comments.*,username,users.have_avatar from comments join users on users.id=owner_id where comments.id=$1
        union
        select c.*,users.username,users.have_avatar from comments c join post_comm pc on c.parent_id = pc.id join users on c.owner_id=users.id
      )
      select * from post_comm `,
      [commentId]
    );

    const comments = getSubComments(commentsData.rows, userId, sort, {
      id: commentId as string,
    });

    return res.status(200).json({ data: comments });
  } catch (error) {
    console.log(error);

    processError(error, res, null);
  }
});

commentsRouter.get("/getCommentVotes", async (req, res) => {
  getTypeVotes(req, res, "comments");
});

commentsRouter.get("/getVotedComments", async (req, res) => {
  getVotedType(req, res, "comments");
});

commentsRouter.post("/setCommentVote", (req, res) => {
  setTypeVote(req, res, "comments");
});

commentsRouter.post("/editComment", async (req, res) => {
  const { commentId } = req.query;
  const { content } = req.body;
  try {
    if (!commentId) throw { message: "No action", code: 200 };
    if (!validate(commentId as string))
      throw { message: "Invalid commentId!", code: 400 };
    if (content.trim().length === 0)
      throw { message: "Content cannot be empty!", code: 400 };
    const token = extractAuthToken(req.headers.authorization);
    const user = await verifyUser(token);
    const commentData = await pool.query(
      `select * from comments where id=$1 and content!=''`,
      [commentId]
    );
    if (commentData.rowCount === 0)
      throw { message: "That comment does not exist!", code: 404 };
    if (commentData.rows[0].owner_id !== user.userId)
      throw { message: "Not authorized!", code: 401 };

    await pool.query(`update comments set content = $1 where id=$2`, [
      content,
      commentId,
    ]);
    return res.status(200).json({ message: "Success!" });
  } catch (error) {
    processError(error, res);
  }
});

commentsRouter.delete("/deleteComment", async (req, res) => {
  const { commentId } = req.query;
  try {
    if (!commentId) throw { message: "No action", code: 200 };
    const token = extractAuthToken(req.headers.authorization);
    const user = await verifyUser(token);
    if (!validate(commentId as string))
      throw { message: "Invalid comment id!", code: 404 };
    const commentData = await pool.query(`select * from comments where id=$1`, [
      commentId,
    ]);
    if (commentData.rowCount === 0)
      throw { message: "That comment does not exist!", code: 404 };
    if (commentData.rows[0].owner_id !== user.userId)
      throw { message: "Not authorized!", code: 401 };

    const isLeaf = await pool.query(
      `select * from comments where id=$1 and not exists (select * from comments where parent_id=$1)`,
      [commentId]
    );
    // if comment is leaf then we can actually delete it
    if (isLeaf.rowCount > 0)
      await pool.query(`delete from comments where id=$1`, [commentId]);
    else
      await pool.query(`update comments set content =$1 where id=$2`, [
        "",
        commentId,
      ]);
    return res.status(200).json({ message: "Success!" });
  } catch (error) {
    console.log("ERORCINA: ", error);

    processError(error, res);
  }
});
