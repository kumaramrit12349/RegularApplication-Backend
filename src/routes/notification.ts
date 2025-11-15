import { Router } from 'express';
import { addCompleteNotification, approveNotification, archiveNotification, editNotification, getHomePageNotifications, getNotificationById, getNotificationsByCategory, unarchiveNotification, viewNotifications } from '../services/notificationService';

const router = Router();
/******************************************************************************
 *             Add Notification - "POST /api/notification/add"
 ******************************************************************************/
router.post("/add", async (req, res) => {
  try {
    const result = await addCompleteNotification(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("Error adding notification:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to add notification" 
    });
  }
});

// Get all active notifications
router.get('/view', async (req, res) => {
  try {
    const notifications = await viewNotifications();
    res.json({ success: true, notifications });
  } catch (err) {
    res.status(500).json({ error: 'Database error', details: err });
  }
});



// Get single notification by ID (for edit/review)
router.get('/getById/:id', async (req, res) => {
  try {
    const notification = await getNotificationById(Number(req.params.id));
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    res.json({ success: true, notification });
  } catch (err) {
    res.status(500).json({ error: 'Database error', details: err });
  }
});


// Edit notification
router.put('/edit/:id', async (req, res) => {
  try {
    const notification = await editNotification(Number(req.params.id), req.body);
    res.json({ success: true, notification });
  } catch (err) {
    res.status(500).json({ error: 'Database error', details: err });
  }
});

// Approve notification
router.patch('/approve/:id', async (req, res) => {
  try {
    const notification = await approveNotification(
      Number(req.params.id),
      req.body.approved_by || 'admin',
      req.body.verified_by || 'admin'
    );
    res.json({ success: true, notification });
  } catch (err) {
    res.status(500).json({ error: 'Database error', details: err });
  }
});

// Delete notification (mark is_archived = true)
router.delete('/delete/:id', async (req, res) => {
  try {
    const notification = await archiveNotification(Number(req.params.id));
    res.json({ success: true, notification });
  } catch (err) {
    res.status(500).json({ error: 'Database error', details: err });
  }
});

// Unarchive notification
router.patch('/unarchive/:id', async (req, res) => {
  try {
    const notification = await unarchiveNotification(Number(req.params.id));
    res.json({ success: true, notification });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unarchive', details: err });
  }
});

// Group notifications by category for the HomePage
router.get('/home', async (req, res) => {
  try {
    const grouped = await getHomePageNotifications();
    res.json({ success: true, data: grouped });
  } catch (err) {
    res.status(500).json({ error: 'Database error', details: err });
  }
});

// Group notifications by category for the HomePage
router.get('/category/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;

    const result = await getNotificationsByCategory(category, page, limit);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: 'Database error', details: err });
  }
});



export default router;
