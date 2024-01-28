import pg from "pg";
import "dotenv/config";

export const pool = new pg.Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.POSTGRES_DB,
  password: process.env.PGPASSWORD,
  port: +process.env.PGPORT!,
});

const updateDb = async () => {
  const users = (await pool.query("select id from users")).rows;
  for (const user of users) {
    console.log(user.id);

    const upvoted_p = (
      await pool.query(`select upvoted_comments from users where id=$1`, [
        user.id,
      ])
    ).rows[0].upvoted_comments;
    if (upvoted_p.length !== 0) {
      const up_p = Array.from(new Set(upvoted_p));
      for (const p of up_p)
        await pool.query(`insert into voted_comments values ($1,$2,$3)`, [
          user.id,
          p,
          true,
        ]);
    }

    const downvoted_p = (
      await pool.query(`select downvoted_comments from users where id=$1`, [
        user.id,
      ])
    ).rows[0].downvoted_comments;

    if (downvoted_p.length !== 0) {
      const dn_p = Array.from(new Set(downvoted_p));
      for (const p of dn_p)
        await pool.query(`insert into voted_comments values ($1,$2,$3)`, [
          user.id,
          p,
          false,
        ]);
    }
  }
};
// updateDb();
