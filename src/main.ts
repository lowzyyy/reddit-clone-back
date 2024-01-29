import "dotenv/config";
import express from "express";

import { authRouter } from "./router/auth/auth.js";
import { communitiesRouter } from "./router/communities/communities.js";
import { postsRouter } from "./router/posts/posts.js";
import { commentsRouter } from "./router/comments/comments.js";
import path from "path";

const app = express();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Cache-Control"
  );
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(authRouter);
app.use(communitiesRouter);
app.use(postsRouter);
app.use(commentsRouter);

app.use(
  "/users",
  express.static(path.resolve(`${process.env.STARTPATHIMG}/users`), {
    extensions: ["webp", "jpg"],
  })
);

app.listen(process.env.PORT || 3110);
