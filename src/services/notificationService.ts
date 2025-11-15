import { pool } from "../config/pgConfig";
import { Notification } from "../models/Notification";

// Helper functions for type conversion
const parseIntSafe = (val: any) => {
  const parsed = parseInt(val);
  return isNaN(parsed) ? null : parsed;
};

const parseDecimalSafe = (val: any) => {
  const parsed = parseFloat(val);
  return isNaN(parsed) ? null : parsed;
};




// Add complete notification with all related tables
export async function addCompleteNotification(data: any) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Helper function to parse integers safely
    const parseIntSafe = (val: any) => {
      const parsed = parseInt(val);
      return isNaN(parsed) ? null : parsed;
    };

    // Helper function to parse decimals safely
    const parseDecimalSafe = (val: any) => {
      const parsed = parseFloat(val);
      return isNaN(parsed) ? null : parsed;
    };

    // 1. Insert into notifications table
    const notificationResult = await client.query(
      `INSERT INTO notifications 
       (title, category, department, total_vacancies, 
        isAdminCardAvailable, isResultPublished, isAnswerKeyPublished, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) 
       RETURNING id`,
      [
        data.title,
        data.category,
        null, // We'll handle department separately if needed
        parseIntSafe(data.total_vacancies),
        data.isAdminCardAvailable || false,
        data.isResultPublished || false,
        data.isAnswerKeyPublished || false,
      ]
    );

    const notificationId = notificationResult.rows[0].id;

    // 2. Insert into important_dates (if any dates provided)
    if (data.application_begin_date || data.last_date_for_apply || data.exam_date) {
      await client.query(
        `INSERT INTO important_dates 
         (notification_id, application_begin_date, last_date_for_apply, 
          exam_date, admit_card_available_date, result_date) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          notificationId,
          data.application_begin_date || null,
          data.last_date_for_apply || null,
          data.exam_date || null,
          data.admit_card_available_date || null,
          data.result_date || null,
        ]
      );
    }

    // 3. Insert into fees (if any fees provided)
    if (data.general_fee || data.obc_fee || data.sc_fee) {
      await client.query(
        `INSERT INTO fees 
         (notification_id, general_fee, obc_fee, sc_fee, st_fee, ph_fee, other_fee_details) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          notificationId,
          parseDecimalSafe(data.general_fee),
          parseDecimalSafe(data.obc_fee),
          parseDecimalSafe(data.sc_fee),
          parseDecimalSafe(data.st_fee),
          parseDecimalSafe(data.ph_fee),
          data.other_fee_details || null,
        ]
      );
    }

    // 4. Insert into eligibility (if ages provided)
    let eligibilityId = null;
    if (data.min_age || data.max_age) {
      const eligibilityResult = await client.query(
        `INSERT INTO eligibility 
         (notification_id, min_age, max_age, age_relaxation_details) 
         VALUES ($1, $2, $3, $4) 
         RETURNING id`,
        [
          notificationId,
          parseIntSafe(data.min_age),
          parseIntSafe(data.max_age),
          data.age_relaxation_details || null,
        ]
      );
      eligibilityId = eligibilityResult.rows[0].id;
    }

    // 5. Insert into education_qualifications (if qualification provided)
    if (eligibilityId && data.qualification) {
      await client.query(
        `INSERT INTO education_qualifications 
         (eligibility_id, qualification, specialization, min_percentage, additional_details) 
         VALUES ($1, $2, $3, $4, $5)`,
        [
          eligibilityId,
          data.qualification,
          data.specialization || null,
          parseDecimalSafe(data.min_percentage),
          data.additional_details || null,
        ]
      );
    }

    // 6. Insert into links (if any links provided)
    if (data.apply_online_url || data.notification_pdf_url) {
      await client.query(
        `INSERT INTO links 
         (notification_id, apply_online_url, notification_pdf_url, 
          official_website_url, admit_card_url, result_url, answer_key_url, other_links) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          notificationId,
          data.apply_online_url || null,
          data.notification_pdf_url || null,
          data.official_website_url || null,
          data.admit_card_url || null,
          data.result_url || null,
          data.answer_key_url || null,
          data.other_links || null,
        ]
      );
    }

    await client.query("COMMIT");

    return {
      success: true,
      notificationId,
      message: "Notification added successfully",
    };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Transaction error:", error);
    throw error;
  } finally {
    client.release();
  }
}

// View all notifications (excluding archived)
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



// Get single notification by ID with all related data
export async function getNotificationById(id: number) {
  const result = await pool.query(
    `SELECT n.*, 
      id.application_begin_date, id.last_date_for_apply, id.exam_date, 
      id.admit_card_available_date, id.result_date,
      f.general_fee, f.obc_fee, f.sc_fee, f.st_fee, f.ph_fee, f.other_fee_details,
      e.min_age, e.max_age, e.age_relaxation_details,
      eq.qualification, eq.specialization, eq.min_percentage, eq.additional_details,
      l.apply_online_url, l.notification_pdf_url, l.official_website_url,
      l.admit_card_url, l.result_url, l.answer_key_url, l.other_links
    FROM notifications n
    LEFT JOIN important_dates id ON n.id = id.notification_id
    LEFT JOIN fees f ON n.id = f.notification_id
    LEFT JOIN eligibility e ON n.id = e.notification_id
    LEFT JOIN education_qualifications eq ON e.id = eq.eligibility_id
    LEFT JOIN links l ON n.id = l.notification_id
    WHERE n.id = $1`,
    [id]
  );
  
  return result.rows[0] || null;
}



// Edit notification with all related tables
export async function editNotification(id: number, data: any) {
  const client = await pool.connect();
  
  try {
    await client.query("BEGIN");

    // Helper functions
    const parseIntSafe = (val: any) => {
      const parsed = parseInt(val);
      return isNaN(parsed) ? null : parsed;
    };

    const parseDecimalSafe = (val: any) => {
      const parsed = parseFloat(val);
      return isNaN(parsed) ? null : parsed;
    };

    // 1. Update main notifications table
    await client.query(
      `UPDATE notifications 
       SET title = $1, 
           category = $2, 
           department = $3,
           total_vacancies = $4,
           isAdminCardAvailable = $5, 
           isResultPublished = $6, 
           isAnswerKeyPublished = $7, 
           updated_at = NOW()
       WHERE id = $8`,
      [
        data.title,
        data.category,
        data.department,
        parseIntSafe(data.total_vacancies),
        data.isadmincardavailable || false,
        data.isresultpublished || false,
        data.isanswerkeypublished || false,
        id
      ]
    );

    // 2. Update or Insert important_dates
    const datesCheck = await client.query(
      'SELECT id FROM important_dates WHERE notification_id = $1',
      [id]
    );

    if (datesCheck.rows.length > 0) {
      // Update existing dates
      await client.query(
        `UPDATE important_dates 
         SET application_begin_date = $1,
             last_date_for_apply = $2,
             exam_date = $3,
             admit_card_available_date = $4,
             result_date = $5
         WHERE notification_id = $6`,
        [
          data.application_begin_date || null,
          data.last_date_for_apply || null,
          data.exam_date || null,
          data.admit_card_available_date || null,
          data.result_date || null,
          id
        ]
      );
    } else if (data.application_begin_date || data.last_date_for_apply || data.exam_date) {
      // Insert new dates
      await client.query(
        `INSERT INTO important_dates 
         (notification_id, application_begin_date, last_date_for_apply, 
          exam_date, admit_card_available_date, result_date)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          data.application_begin_date || null,
          data.last_date_for_apply || null,
          data.exam_date || null,
          data.admit_card_available_date || null,
          data.result_date || null
        ]
      );
    }

    // 3. Update or Insert fees
    const feesCheck = await client.query(
      'SELECT id FROM fees WHERE notification_id = $1',
      [id]
    );

    if (feesCheck.rows.length > 0) {
      // Update existing fees
      await client.query(
        `UPDATE fees 
         SET general_fee = $1,
             obc_fee = $2,
             sc_fee = $3,
             st_fee = $4,
             ph_fee = $5,
             other_fee_details = $6
         WHERE notification_id = $7`,
        [
          parseDecimalSafe(data.general_fee),
          parseDecimalSafe(data.obc_fee),
          parseDecimalSafe(data.sc_fee),
          parseDecimalSafe(data.st_fee),
          parseDecimalSafe(data.ph_fee),
          data.other_fee_details || null,
          id
        ]
      );
    } else if (data.general_fee || data.obc_fee || data.sc_fee) {
      // Insert new fees
      await client.query(
        `INSERT INTO fees 
         (notification_id, general_fee, obc_fee, sc_fee, st_fee, ph_fee, other_fee_details)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          parseDecimalSafe(data.general_fee),
          parseDecimalSafe(data.obc_fee),
          parseDecimalSafe(data.sc_fee),
          parseDecimalSafe(data.st_fee),
          parseDecimalSafe(data.ph_fee),
          data.other_fee_details || null
        ]
      );
    }

    // 4. Update or Insert eligibility
    const eligibilityCheck = await client.query(
      'SELECT id FROM eligibility WHERE notification_id = $1',
      [id]
    );

    let eligibilityId = null;

    if (eligibilityCheck.rows.length > 0) {
      // Update existing eligibility
      eligibilityId = eligibilityCheck.rows[0].id;
      await client.query(
        `UPDATE eligibility 
         SET min_age = $1,
             max_age = $2,
             age_relaxation_details = $3
         WHERE notification_id = $4`,
        [
          parseIntSafe(data.min_age),
          parseIntSafe(data.max_age),
          data.age_relaxation_details || null,
          id
        ]
      );
    } else if (data.min_age || data.max_age) {
      // Insert new eligibility
      const eligibilityResult = await client.query(
        `INSERT INTO eligibility 
         (notification_id, min_age, max_age, age_relaxation_details)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          id,
          parseIntSafe(data.min_age),
          parseIntSafe(data.max_age),
          data.age_relaxation_details || null
        ]
      );
      eligibilityId = eligibilityResult.rows[0].id;
    }

    // 5. Update or Insert education_qualifications
    if (eligibilityId) {
      const educationCheck = await client.query(
        'SELECT id FROM education_qualifications WHERE eligibility_id = $1',
        [eligibilityId]
      );

      if (educationCheck.rows.length > 0) {
        // Update existing education
        await client.query(
          `UPDATE education_qualifications 
           SET qualification = $1,
               specialization = $2,
               min_percentage = $3,
               additional_details = $4
           WHERE eligibility_id = $5`,
          [
            data.qualification || null,
            data.specialization || null,
            parseDecimalSafe(data.min_percentage),
            data.additional_details || null,
            eligibilityId
          ]
        );
      } else if (data.qualification) {
        // Insert new education
        await client.query(
          `INSERT INTO education_qualifications 
           (eligibility_id, qualification, specialization, min_percentage, additional_details)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            eligibilityId,
            data.qualification,
            data.specialization || null,
            parseDecimalSafe(data.min_percentage),
            data.additional_details || null
          ]
        );
      }
    }

    // 6. Update or Insert links
    const linksCheck = await client.query(
      'SELECT id FROM links WHERE notification_id = $1',
      [id]
    );

    if (linksCheck.rows.length > 0) {
      // Update existing links
      await client.query(
        `UPDATE links 
         SET apply_online_url = $1,
             notification_pdf_url = $2,
             official_website_url = $3,
             admit_card_url = $4,
             result_url = $5,
             answer_key_url = $6,
             other_links = $7
         WHERE notification_id = $8`,
        [
          data.apply_online_url || null,
          data.notification_pdf_url || null,
          data.official_website_url || null,
          data.admit_card_url || null,
          data.result_url || null,
          data.answer_key_url || null,
          data.other_links || null,
          id
        ]
      );
    } else if (data.apply_online_url || data.notification_pdf_url) {
      // Insert new links
      await client.query(
        `INSERT INTO links 
         (notification_id, apply_online_url, notification_pdf_url, 
          official_website_url, admit_card_url, result_url, answer_key_url, other_links)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          data.apply_online_url || null,
          data.notification_pdf_url || null,
          data.official_website_url || null,
          data.admit_card_url || null,
          data.result_url || null,
          data.answer_key_url || null,
          data.other_links || null
        ]
      );
    }

    await client.query("COMMIT");
    
    // Return updated notification
    return await getNotificationById(id);
    
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Edit notification error:", error);
    throw error;
  } finally {
    client.release();
  }
}


// Approve notification
export async function approveNotification(id: number, approvedBy: string, verifiedBy: string) {
  const result = await pool.query(
    `UPDATE notifications 
     SET approved_at = NOW(), approved_by = $1, 
         verified_at = NOW(), verified_by = $2
     WHERE id = $3
     RETURNING *`,
    [approvedBy, verifiedBy, id]
  );
  
  return result.rows[0];
}

// Archive notification (soft delete)
export async function archiveNotification(id: number) {
  const result = await pool.query(
    `UPDATE notifications 
     SET isArchived = true, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  
  return result.rows[0];
}


// Unarchive notification
export async function unarchiveNotification(id: number) {
  const result = await pool.query(
    `UPDATE notifications 
     SET isArchived = false, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  
  return result.rows[0];
}

export async function getHomePageNotifications(): Promise<Record<string, Array<{ name: string, notification_id: string }>>> {
  // Check for is_archived column existence
  const checkColumn = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'isarchived'
  `);

  // Only proceed if is_archived column actually exists
  if (!checkColumn || checkColumn.rowCount === 0) {
    // If is_archived does NOT exist, return empty (or handle as per your app logic)
    return {};
  }

  // Now fetch only those notifications which are not archived and approved
  const result = await pool.query(
    `SELECT id, title, category
     FROM notifications
     WHERE isarchived = FALSE
       AND approved_at IS NOT NULL
     ORDER BY created_at DESC`
  );

  // Group notifications by category, mapping to { name, notification_id }
  const grouped: Record<string, Array<{ name: string, notification_id: string }>> = {};
  for (const n of result.rows) {
    const category = n.category || 'Uncategorized';
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push({ name: n.title, notification_id: n.id.toString() });
  }

  return grouped;
}

// Get notifications by category
export async function getNotificationsByCategory(category: string, page: number, limit: number) {
  console.log('category', category, 'page', page, 'limit', limit);
  const offset = (page - 1) * limit;

  const result = await pool.query(
    `SELECT id, title
     FROM notifications
     WHERE isarchived = FALSE
       AND approved_at IS NOT NULL
       AND category = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [category, limit, offset]
  );

  const countResult = await pool.query(
    `SELECT COUNT(*) AS total
     FROM notifications
     WHERE isarchived = FALSE
       AND approved_at IS NOT NULL
       AND category = $1`,
    [category]
  );

  const total = parseInt(countResult.rows[0].total, 10);
  const rowCount = result.rowCount ?? 0; // Safe default!
  const hasMore = offset + rowCount < total;

  const data = result.rows.map(row => ({
    name: row.title,
    notification_id: row.id.toString(),
  }));

  return { data, total, page, hasMore };
}

