import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler } from './utils/errors.js';
import { UPLOAD_DIR } from './utils/upload.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import groupRoutes from './routes/groups.js';
import contactRoutes from './routes/contacts.js';
import companyRoutes from './routes/companies.js';
import ticketRoutes from './routes/tickets.js';
import cannedRoutes from './routes/cannedResponses.js';
import kbRoutes from './routes/kb.js';
import tagRoutes from './routes/tags.js';
import slaRoutes from './routes/sla.js';
import automationRoutes from './routes/automations.js';
import settingsRoutes from './routes/settings.js';
import reportRoutes from './routes/reports.js';
import dashboardRoutes from './routes/dashboard.js';
import { searchRouter, notificationsRouter, savedViewsRouter } from './routes/misc.js';
import configRoutes from './routes/config.js';
import ticketExtraRoutes from './routes/ticketExtras.js';
import forumRoutes from './routes/forums.js';
import analyticsRoutes from './routes/analytics.js';
import inboundRoutes from './routes/inbound.js';
import { query as dbQuery } from './config/db.js';

const app = express();

app.use(cors({ origin: [env.clientUrl, 'http://127.0.0.1:5173', 'http://localhost:5173'], credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

app.use('/uploads', express.static(UPLOAD_DIR));

app.get('/api/health', async (_req, res) => {
  const { query } = await import('./config/db.js');
  try {
    await query('SELECT 1');
    res.json({ status: 'ok', database: 'connected', time: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'unreachable', error: err.message });
  }
});

// Records who changed configuration. Paths only: request bodies can hold secrets.
const AUDITED = /^\/api\/(settings|agents|groups|sla-policies|automations|config)\b/;
app.use((req, res, next) => {
  if (req.method !== 'GET' && AUDITED.test(req.path)) {
    res.on('finish', () => {
      if (res.statusCode < 400 && req.user?.kind === 'user') {
        dbQuery('INSERT INTO audit_log (user_id, actor_label, method, path, status) VALUES ($1,$2,$3,$4,$5)', [req.user.id, req.user.name, req.method, req.path, res.statusCode]).catch((err) => console.error('[audit]', err.message));
      }
    });
  }
  next();
});

app.use('/api', inboundRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/agents', userRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/tickets', ticketExtraRoutes, ticketRoutes);
app.use('/api/canned-responses', cannedRoutes);
app.use('/api/kb', kbRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/sla-policies', slaRoutes);
app.use('/api/automations', automationRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/search', searchRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/saved-views', savedViewsRouter);
app.use('/api/config', configRoutes);
app.use('/api/forums', forumRoutes);
app.use('/api/analytics', analyticsRoutes);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Route not found' }));
app.use(errorHandler);

export default app;
