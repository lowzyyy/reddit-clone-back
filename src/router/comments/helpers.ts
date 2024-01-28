import { Request, Response } from "express";
import {
  extractAuthToken,
  processError,
  verifyUser,
} from "../../helpers/globalHelpers.js";
import { pool } from "../../db/dbController.js";
import { getVotedComments, getVotedPosts } from "../auth/helpers.js";
import { validate } from "uuid";

export type TCommentWSubcomment = TComment & {
  isOwner: boolean;
  level: number;
} & {
  subComments: TCommentWSubcomment[] | null;
};

export type TComment = {
  id: string;
  parent_id: string | null;
  post_id: string;
  owner_id?: string;
  username: string;
  content: string;
  createdAt: number;
  votes: number;
};

export type TSort = "newest" | "oldest" | "top";

export const sortFunction = (sort: TSort) => {
  if (sort === "newest")
    return (a: TComment, b: TComment) => b.createdAt - a.createdAt;
  else if (sort === "oldest")
    return (a: TComment, b: TComment) => a.createdAt - b.createdAt;
  else if (sort === "top")
    return (a: TComment, b: TComment) => b.votes - a.votes;
  else return (a: TComment, b: TComment) => b.votes - a.votes;
};

export const getSubComments = (
  commentsData: TComment[],
  userId: string | null,
  sortType: TSort,
  single?: { id: string }
) => {
  // its efficient to get relations between parent and children in one loop than to check loop every time for every comment
  const parentChildren = new Map<string, Array<TComment>>();
  for (const comment of commentsData) {
    if (comment.parent_id === null) continue;
    let children = parentChildren.get(comment.parent_id);
    if (!children) {
      children = [];
      parentChildren.set(comment.parent_id, children);
    }
    children.push(comment);
  }

  const subComm = (
    comment: TComment,
    level: number = 0
  ): TCommentWSubcomment => {
    const ifExist = parentChildren.get(comment.id);

    return {
      level,
      ...comment,
      isOwner: userId === null || userId !== comment.owner_id ? false : true,
      subComments: ifExist
        ? ifExist
            .map((comm) => subComm(comm, level + 1))
            .sort(sortFunction(sortType))
        : null,
    };
  };
  if (!single)
    return commentsData
      .filter((comment) => comment.parent_id === null)
      .map((comm) => subComm(comm))
      .sort(sortFunction(sortType));
  else
    return commentsData
      .filter((comment) => comment.id === single.id)
      .map((comm) => subComm(comm))
      .sort(sortFunction(sortType));
};

export const validateSort = (sortType: string) => {
  const sort = sortType.toLowerCase();
  if (sort !== "newest" && sort !== "oldest" && sort !== "top") return "newest";
  else return sort;
};
// functions for comments and posts response

export const getTypeVotes = async (
  req: Request,
  res: Response,
  type: "posts" | "comments"
) => {
  const { term } = req.query;
  try {
    if (!term) throw { message: "No action", code: 200 };
    if (!validate(term as string)) throw { message: "Invalid id!", code: 400 };
    const votesData = await pool.query(
      `select votes from ${type} where id=$1`,
      [term]
    );
    if (votesData.rowCount === 0)
      throw {
        message: `${type === "posts" ? "Post" : "Comment"} does not exist!`,
        code: 404,
      };
    return res.status(200).json({ data: votesData.rows[0] });
  } catch (error: any) {
    processError(error, res, null);
  }
};

export const getVotedType = async (
  req: Request,
  res: Response,
  type: "posts" | "comments"
) => {
  try {
    const token = extractAuthToken(req.headers.authorization);
    const user = await verifyUser(token);
    const votedType =
      type === "posts"
        ? await getVotedPosts(user.userId)
        : await getVotedComments(user.userId);
    return res.status(200).json({ data: votedType });
  } catch (error) {
    processError(error, res, null);
  }
};

export const setTypeVote = async (
  req: Request,
  res: Response,
  typeEndpoint: "posts" | "comments"
) => {
  const availableAmounts = new Set([1, 2, -1, -2]);
  const { term, type, amount } = req.query;
  const client = await pool.connect();
  try {
    const token = extractAuthToken(req.headers.authorization);
    const user = await verifyUser(token);
    if (!term || !type || !amount) throw { message: "No action", code: 200 };
    if (!validate(term as string)) throw { message: "Invalid id!", code: 400 };
    let amountValidated;
    if (isFinite(amount as unknown as number) && availableAmounts.has(+amount))
      amountValidated = +amount;
    else throw { message: "Amount can be -1,-2,1,2 !", code: 400 };
    const votesData = await pool.query(
      `select votes from ${typeEndpoint} where id=$1`,
      [term]
    );
    if (votesData.rowCount === 0)
      throw {
        message: `${
          typeEndpoint === "posts" ? "Post" : "Comment"
        } does not exist!`,
        code: 404,
      };

    let typeQuery: string, usersQuery: string;
    const typeTable = typeEndpoint === "comments" ? "comment" : "post";

    await client.query("BEGIN");
    typeQuery = `update ${typeEndpoint} set votes=votes+$2 where id=$1`;
    if (type === "upvote") {
      usersQuery = `INSERT INTO voted_${typeEndpoint} values($1,$2,true) ON CONFLICT  ON CONSTRAINT voted_${typeEndpoint}_pkey DO UPDATE set voted=true`;
    } else if (type === "downvote") {
      usersQuery = `INSERT INTO voted_${typeEndpoint} values($1,$2,false) ON CONFLICT  ON CONSTRAINT voted_${typeEndpoint}_pkey DO UPDATE set voted=false`;
    } else if (type === "remove") {
      usersQuery = `DELETE from voted_${typeEndpoint} where user_id=$1 and ${typeTable}_id=$2`;
    } else throw { message: "Wrong vote type!", code: 200 };

    await client.query(typeQuery, [term, amountValidated]);
    await client.query(usersQuery, [user.userId, term]);
    await client.query("COMMIT");
    client.release();

    return res.status(200).json({ message: "Success!" });
  } catch (error: any) {
    console.log(error);

    await client.query("ROLLBACK");
    client.release();
    processError(error, res);
  }
};
