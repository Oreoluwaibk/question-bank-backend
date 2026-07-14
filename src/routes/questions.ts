import { Request, Response, Router } from 'express';
import { supabaseAdmin } from '../services/supabaseAdmin';
import { requireAuth } from '../middlewares/auth';
import { CreateQuestionInput } from '../types/question.types';
import { sanitizeQuestionForDb } from '../lib/questionSanitizer';
import { requireProSubscription } from '../services/subscriptionService';
import { subscriptionErrorResponse } from '../lib/subscriptionErrors';
import {
  formatQuestionsAsHtml,
  formatQuestionsAsText,
} from '../lib/questionExport';

const ALLOWED_UPDATE_FIELDS: Record<string, string> = {
  question: 'question',
  options: 'options',
  answer: 'answer',
  topic: 'topic',
  domain: 'domain',
  type: 'type',
  language: 'language',
  isPublished: 'is_published',
  materialTitle: 'material_title',
};

function pickAllowedUpdates(body: Record<string, unknown>): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(ALLOWED_UPDATE_FIELDS)) {
    if (key in body) {
      updates[column] = body[key];
    }
  }
  return updates;
}

const router = Router();

router
.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
      await requireProSubscription(req.user!.id);
    } catch (err) {
      const response = subscriptionErrorResponse(res, err);
      if (response) return response;
      return res.status(403).json({ error: 'Subscription required' });
    }

    const questions = req.body as CreateQuestionInput[];

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const rows = questions
      .map((q) => {
        const sanitized = sanitizeQuestionForDb({
          type: q.type,
          question: q.question,
          options: q.options,
          answer: q.answer,
          topic: q.topic,
          domain: q.domain,
        });
        if (!sanitized) return null;
        return {
          creator_id: req.user!.id,
          material_title: q.materialTitle,
          type: sanitized.type,
          question: sanitized.question,
          options: sanitized.options ?? null,
          answer: sanitized.answer ?? null,
          topic: sanitized.topic ?? null,
          domain: sanitized.domain,
          language: q.language ?? 'en',
          is_published: q.isPublished ?? false,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    if (!rows.length) {
      return res.status(400).json({ error: 'No valid questions in payload' });
    }

    const { data, error } = await supabaseAdmin
      .from('questions')
      .insert(rows)
      .select();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json(data);
})
.patch('/:id', requireAuth, async (req: Request, res: Response) => {
    const { id } = req.params;

    const updates = pickAllowedUpdates(req.body);

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data, error } = await supabaseAdmin
      .from('questions')
      .update(updates)
      .eq('id', id)
      .eq('creator_id', req.user!.id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json(data);
})
.get('/', requireAuth, async (req: Request, res: Response) => {

    const { data, error } = await supabaseAdmin
      .from('questions')
      .select('*')
      .eq('creator_id', req.user!.id)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json(data);
})
.get('/materials', requireAuth, async (req: Request, res: Response) => {
    const { data, error } = await supabaseAdmin
      .from('materials')
      .select('id, title, source_file, question_count, created_at')
      .eq('user_id', req.user!.id)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json(data ?? []);
})
.get('/material/:title/export', requireAuth, async (req: Request, res: Response) => {
    try {
      await requireProSubscription(req.user!.id);
    } catch (err) {
      const response = subscriptionErrorResponse(res, err);
      if (response) return response;
      return res.status(403).json({ error: 'Subscription required' });
    }

    const { title } = req.params;
    const includeAnswers = req.query.includeAnswers !== 'false';

    const { data, error } = await supabaseAdmin
      .from('questions')
      .select('type, question, options, answer, topic, domain')
      .eq('creator_id', req.user!.id)
      .eq('material_title', title)
      .order('created_at', { ascending: true });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    if (!data?.length) {
      return res.status(404).json({ error: 'No questions found for this material' });
    }

    res.json({
      materialTitle: title,
      questionCount: data.length,
      text: formatQuestionsAsText(title, data, includeAnswers),
      html: formatQuestionsAsHtml(title, data, includeAnswers),
      includeAnswers,
    });
})
.get('/material/:title', requireAuth, async (req: Request, res: Response) => {
    const { title } = req.params;

    const { data, error } = await supabaseAdmin
      .from('questions')
      .select('*')
      .eq('creator_id', req.user!.id)
      .eq('material_title', title);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json(data);
})
.get('/type/:type', requireAuth, async (req: Request, res: Response) => {
    const { type } = req.params;

    const { data, error } = await supabaseAdmin
      .from('questions')
      .select('*')
      .eq('creator_id', req.user!.id)
      .eq('type', type);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json(data);
})
.get('/domain/:domain', requireAuth, async (req: Request, res: Response) => {
    const { domain } = req.params;

    const { data, error } = await supabaseAdmin
      .from('questions')
      .select('*')
      .eq('creator_id', req.user!.id)
      .eq('domain', domain);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json(data);
})
.get(
  '/topic/:topic', requireAuth,async (req: Request, res: Response) => {
    const { topic } = req.params;

    const { data, error } = await supabaseAdmin
      .from('questions')
      .select('*')
      .eq('creator_id', req.user!.id)
      .ilike('topic', `%${topic}%`);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json(data);
});

export default router;




