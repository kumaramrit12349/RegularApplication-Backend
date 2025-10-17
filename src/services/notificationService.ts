import { pool } from "../config/pgConfig";
import { Notification } from "../models/Notification";

export async function addNotification(
  data: Omit<Notification, "id" | "createdAt">
): Promise<Notification> {
  const result = await pool.query(
    "INSERT INTO notifications (user_id, title, message, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *",
    [data.userId, data.title, data.message]
  );
  return result.rows[0];
}
