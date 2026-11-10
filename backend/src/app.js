
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';

import authRoutes from './routes/auth.routes.js';
import apiRoutes, { portalRouter } from './routes/api.routes.js';
import extendedRoutes from './routes/extended.routes.js';
import adminRoutes from './routes/admin.routes.js';
import cronRoutes from './routes/cron.routes.js';
import integrationsRoutes from './routes/integrations.routes.js';

import { AppError } from './lib/errors.js';

const app = express();

const configuredOrigins = (
  process.env.FRONTEND_URL || ''
)
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const allowedOrigins = new Set([
  ...configuredOrigins,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: 'cross-origin',
    },
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        return callback(null, true);
      }

      return callback(
        new AppError(403, 'Origem não autorizada pelo CORS.')
      );
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

app.use('/api/v1/auth', authLimiter, authRoutes);
app.use('/api/v1/cron', cronRoutes);
app.use('/api/v1/portal', authLimiter, portalRouter);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/integrations', integrationsRoutes);
app.use('/api/v1', apiRoutes);
app.use('/api/v1', extendedRoutes);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'imobgestor-api',
  });
});

// 404
app.use((req, res, next) => {
  next(new AppError(404, 'Rota não encontrada.'));
});

// Centralized error handler
app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error?.name === 'ZodError') {
    return res.status(400).json({
      error: 'Dados inválidos.',
      details: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  if (error?.code === 'P2002') {
    return res.status(409).json({
      error: 'Já existe um registro com esses dados.',
    });
  }

  if (error?.code === 'P2025') {
    return res.status(404).json({
      error: 'Registro não encontrado.',
    });
  }

  const status =
    Number(error?.statusCode || error?.status) || 500;

  if (status >= 500) {
    console.error('[imobgestor-api-error]', {
      message: error?.message,
      path: req.originalUrl,
      method: req.method,
      stack:
        process.env.NODE_ENV === 'development'
          ? error?.stack
          : undefined,
    });
  }

  return res.status(status).json({
    error:
      status >= 500
        ? 'Erro interno. Tente novamente.'
        : error?.message || 'Não foi possível processar a solicitação.',
  });
});

export default app;
