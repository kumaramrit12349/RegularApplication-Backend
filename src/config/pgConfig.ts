// src/config/pgConfig.ts
import { Pool } from 'pg';

export const pool = new Pool({
  host: process.env.AURORA_HOST,
  user: process.env.AURORA_USER,
  password: process.env.AURORA_PASSWORD,
  database: process.env.AURORA_DB,
  port: Number(process.env.AURORA_PORT),
});
