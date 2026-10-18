import express from 'express';
import { runBrowserAudit, createPdf } from './runner.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '25mb', strict: true }));
let busy = false;
app.get('/health/live', (_request, response) => response.json({ status: 'ok', busy }));
app.post(['/audit', '/pdf'], async (request, response) => {
  if (busy) {
    response.status(429).json({ code: 'BROWSER_BUSY' });
    return;
  }
  const audit = request.path === '/audit';
  if (
    audit &&
    (typeof request.body?.url !== 'string' ||
      request.body.url.length > 2048 ||
      typeof request.body?.auditId !== 'string' ||
      !/^[\da-f-]{36}$/i.test(request.body.auditId))
  ) {
    response.status(400).json({ code: 'INVALID_AUDIT_REQUEST' });
    return;
  }
  if (!audit && (typeof request.body?.html !== 'string' || request.body.html.length > 24_000_000)) {
    response.status(400).json({ code: 'INVALID_PDF_REQUEST' });
    return;
  }
  busy = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), audit ? 170_000 : 40_000);
  const onClose = () => {
    if (!response.writableEnded) controller.abort();
  };
  response.on('close', onClose);
  try {
    if (audit) response.json(await runBrowserAudit(request.body.url, controller.signal));
    else
      response.type('application/pdf').send(await createPdf(request.body.html, controller.signal));
  } catch {
    if (!response.headersSent && !response.destroyed)
      response
        .status(controller.signal.aborted ? 504 : 500)
        .json({ code: controller.signal.aborted ? 'BROWSER_TIMEOUT' : 'BROWSER_RUNNER_ERROR' });
  } finally {
    clearTimeout(timer);
    response.removeListener('close', onClose);
    busy = false;
  }
});
app.use(
  (
    _error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    response.status(400).json({ code: 'INVALID_REQUEST' });
  },
);
const server = app.listen(Number(process.env.PORT) || 4100, process.env.HOST ?? '0.0.0.0', () =>
  console.log(JSON.stringify({ service: 'browser', event: 'ready' })),
);
server.requestTimeout = 180_000;
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
