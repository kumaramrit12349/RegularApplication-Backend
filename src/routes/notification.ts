import { Router } from 'express';
import { addNotification, archiveNotification, editNotification, viewNotifications } from '../services/notificationService';

const router = Router();

// Add new notifications
router.post('/add', async (req, res) => {
  try {
    const notification = await addNotification(req.body);
    res.json({ success: true, notification });
  } catch (err) {
    res.status(500).json({ error: 'Database error', details: err });
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


// Edit notifications
router.put('/edit/:id', async (req, res) => {
  try {
    const notification = await editNotification(Number(req.params.id), req.body);
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

export default router;
