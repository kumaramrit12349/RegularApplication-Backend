// src/config/pgConfig.ts
import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

export const pool = new Pool({
  host: process.env.AURORA_HOST,
  user: process.env.AURORA_USER,
  password: process.env.AURORA_PASSWORD,
  database: process.env.AURORA_DB,
  port: Number(process.env.AURORA_PORT),
  ssl: { rejectUnauthorized: false }
});
