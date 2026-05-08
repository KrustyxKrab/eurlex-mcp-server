/**
 * REST API layer — consumed by the Power Platform Custom Connector.
 * Endpoints mirror the OpenAPI spec in connector/eurlex-connector.yaml.
 *
 * Mount with: app.use(apiKeyGuard, restRouter)
 */
import { Router, type IRouter, type Request, type Response } from 'express';

import { logger } from './logger.js';
import { CellarClient } from './services/cellarClient.js';
import { processContent } from './utils.js';

export const restRouter: IRouter = Router();

const client = new CellarClient();

// ---------------------------------------------------------------------------
// GET /search
// ---------------------------------------------------------------------------
restRouter.get('/search', async (req: Request, res: Response) => {
  const {
    query = '',
    resource_type = 'any',
    language = 'ENG',
    date_from,
    date_to,
    limit = '10',
  } = req.query as Record<string, string>;

  if (!query.trim()) {
    res.status(400).json({ error: 'query parameter is required' });
    return;
  }

  try {
    const { results } = await client.sparqlQuery(query, {
      resource_type,
      language,
      limit: Math.min(Number(limit) || 10, 50),
      date_from: date_from || undefined,
      date_to: date_to || undefined,
    });
    res.json({ count: results.length, results });
  } catch (err) {
    logger.error({ err }, 'REST /search failed');
    res.status(502).json({ error: 'Upstream SPARQL error', detail: String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /fetch/:celex_id
// ---------------------------------------------------------------------------
restRouter.get('/fetch/:celex_id', async (req: Request, res: Response) => {
  const { celex_id } = req.params;
  const {
    language = 'ENG',
    format = 'plain',
    max_chars = '20000',
  } = req.query as Record<string, string>;

  try {
    const raw = await client.fetchDocument(celex_id, language);
    const { content } = processContent(
      raw,
      format === 'xhtml' ? 'xhtml' : 'plain',
      Math.min(Number(max_chars) || 20000, 50000),
    );
    res.json({ celex: celex_id, text: content, chars: content.length });
  } catch (err) {
    const msg = String(err);
    const status = msg.includes('not found') ? 404 : 502;
    logger.error({ err, celex_id }, 'REST /fetch failed');
    res.status(status).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// GET /metadata/:celex_id
// ---------------------------------------------------------------------------
restRouter.get('/metadata/:celex_id', async (req: Request, res: Response) => {
  const { celex_id } = req.params;
  const { language = 'ENG' } = req.query as Record<string, string>;

  try {
    const meta = await client.metadataQuery(celex_id, language);
    res.json(meta);
  } catch (err) {
    const msg = String(err);
    const status = msg.includes('No metadata') ? 404 : 502;
    logger.error({ err, celex_id }, 'REST /metadata failed');
    res.status(status).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// GET /citations/:celex_id
// ---------------------------------------------------------------------------
restRouter.get('/citations/:celex_id', async (req: Request, res: Response) => {
  const { celex_id } = req.params;
  const {
    direction = 'both',
    language = 'ENG',
    limit = '20',
  } = req.query as Record<string, string>;

  try {
    const result = await client.citationsQuery(
      celex_id,
      language,
      direction as 'cites' | 'cited_by' | 'both',
      Math.min(Number(limit) || 20, 100),
    );
    res.json(result);
  } catch (err) {
    logger.error({ err, celex_id }, 'REST /citations failed');
    res.status(502).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /changes  — documents published since `since` (default: 30 days ago)
// Power Automate stores the last `since` date itself and passes it each call.
// ---------------------------------------------------------------------------
restRouter.get('/changes', async (req: Request, res: Response) => {
  const {
    resource_type = 'any',
    language = 'ENG',
    limit = '200',
  } = req.query as Record<string, string>;

  let { since } = req.query as Record<string, string>;
  if (!since) {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    since = d.toISOString().slice(0, 10);
  }

  try {
    const results = await client.recentDocuments({
      resource_type,
      language,
      limit: Math.min(Number(limit) || 200, 500),
      date_from: since,
    });
    res.json({
      since,
      count: results.length,
      results,
    });
  } catch (err) {
    logger.error({ err }, 'REST /changes failed');
    res.status(502).json({ error: String(err) });
  }
});
