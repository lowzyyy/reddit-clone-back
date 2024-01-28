import pg from "pg";

export const pool = new pg.Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.POSTGRES_DB,
  password: process.env.PGPASSWORD,
  port: +process.env.PGPORT!,
});

pg.types.setTypeParser(20, (value) => parseInt(value));
pg.types.setTypeParser(1700, (value) => parseFloat(value));
