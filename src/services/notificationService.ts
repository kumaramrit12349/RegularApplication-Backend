import { pool } from "../config/pgConfig";
import { Notification } from "../models/Notification";

export async function addNotification(
  data: Omit<Notification, "id" | "createdAt">
): Promise<Notification> {
  const result = await pool.query(
    "INSERT INTO notifications (user_id, title, message, is_archived, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *",
    [data.userId, data.title, data.message, false]
  );
  return result.rows[0];
}

export async function viewNotifications(): Promise<Notification[]> {
  const checkColumn = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'is_archived'
  `);

  let result;

  if (checkColumn && checkColumn.rowCount != null && checkColumn.rowCount > 0) {
    result = await pool.query(
      'SELECT * FROM notifications WHERE is_archived = FALSE ORDER BY created_at DESC'
    );
  } else {
    result = await pool.query(
      'SELECT * FROM notifications ORDER BY created_at DESC'
    );
  }

  return result.rows;
}



export async function editNotification(
  id: number,
  data: Pick<Notification, 'title' | 'message'>
): Promise<Notification> {
  const result = await pool.query(
    'UPDATE notifications SET title = $1, message = $2 WHERE id = $3 RETURNING *',
    [data.title, data.message, id]
  );
  return result.rows[0];
}

export async function archiveNotification(id: number): Promise<Notification> {
  const result = await pool.query(
    'UPDATE notifications SET is_archived = TRUE WHERE id = $1 RETURNING *',
    [id]
  );
  return result.rows[0];
}

