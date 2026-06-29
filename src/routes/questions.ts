import { Request, Response, Router } from 'express';
import { supabaseAdmin } from '../services/supabaseAdmin';
import { requireAuth } from '../middlewares/auth';
import { CreateQuestionInput } from '../types/question.types';

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
    const questions = req.body as CreateQuestionInput[];

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const rows = questions.map(q => ({
      creator_id: req.user!.id,
      material_title: q.materialTitle,
      type: q.type,
      question: q.question,
      options: q.options ?? null,
      answer: q.answer ?? null,
      topic: q.topic ?? null,
      domain: q.domain,
      language: q.language ?? 'en',
      is_published: q.isPublished ?? false
    }));

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




