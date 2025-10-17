import { Router } from 'express';
import { addNotification } from '../services/notificationService';

const router = Router();
router.post('/add', async (req, res) => {
  try {
    const notification = await addNotification(req.body);
    res.json({ success: true, notification });
  } catch (err) {
    res.status(500).json({ error: 'Database error', details: err });
  }
});
export default router;
