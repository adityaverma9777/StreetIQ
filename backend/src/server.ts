import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { logger } from './middleware/logger';
import { RouteRequestSchema, GeocodeQuerySchema } from './middleware/validate';
import { getRoute } from './services/routing';
import { geocode } from './services/geocoding';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = parseInt(process.env.PORT || '3001', 10);
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173', 'https://streetiq-rose.vercel.app'];

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: ALLOWED_ORIGINS, methods: ['GET', 'POST', 'OPTIONS'], credentials: true }));
app.use(compression());
app.use(express.json({ limit: '50kb' }));

app.use((req, _res, next) => {
  logger.info({ method: req.method, url: req.url }, 'request');
  next();
});

const apiLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
app.use('/api', apiLimiter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

app.post('/api/route', async (req: Request, res: Response): Promise<void> => {
  const parsed = RouteRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten().fieldErrors });
    return;
  }
  const { start, end } = parsed.data;
  if (start[0] === end[0] && start[1] === end[1]) {
    res.status(400).json({ error: 'Start and end must be different' });
    return;
  }
  try {
    const result = await getRoute(start, end);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Routing failed';
    logger.error({ err, start, end }, 'route computation failed');
    res.status(msg.includes('No route') ? 404 : 503).json({ error: msg });
  }
});

app.get('/api/geocode', async (req: Request, res: Response): Promise<void> => {
  const parsed = GeocodeQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const results = await geocode(parsed.data.q, parsed.data.limit);
    res.json(results);
  } catch (err) {
    logger.error({ err }, 'geocoding failed');
    res.status(503).json({ error: 'Geocoding service unavailable' });
  }
});

const clients = new Map<string, WebSocket>();

wss.on('connection', (ws, req) => {
  const sessionId = new URL(req.url!, `http://localhost`).searchParams.get('session') || crypto.randomUUID();
  clients.set(sessionId, ws);
  logger.info({ sessionId }, 'WS client connected');

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'location_update') {
        const payload = JSON.stringify({ type: 'location_broadcast', sessionId, ...msg });
        clients.forEach((client, id) => {
          if (id !== sessionId && client.readyState === WebSocket.OPEN) {
            client.send(payload);
          }
        });
      }
    } catch {
      logger.warn('malformed WS message');
    }
  });

  ws.on('close', () => {
    clients.delete(sessionId);
    logger.info({ sessionId }, 'WS client disconnected');
  });

  ws.send(JSON.stringify({ type: 'connected', sessionId }));
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

server.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT }, 'StreetIQ backend running');
});

export default app;
