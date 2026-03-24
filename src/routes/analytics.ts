import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabaseAdmin } from "../services/supabaseAdmin";



const router = Router();
router
.get('/summary', requireAuth, async (req, res) => {
    const { data, error } = await supabaseAdmin
        .from('attempts')
        .select(
        'score, max_score, accuracy, time_used_seconds'
        )
        .eq('user_id', req.user!.id)
        .not('completed_at', 'is', null);

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    if (!data || data.length === 0) {
        return res.json({
        totalAttempts: 0,
        averageAccuracy: 0,
        bestScore: 0,
        averageTimeSeconds: 0
        });
    }

    const totalAttempts = data.length;
    const averageAccuracy =
        data.reduce((sum, a) => sum + (a.accuracy ?? 0), 0) / totalAttempts;

    const bestScore = Math.max(...data.map(a => a.score ?? 0));

    const averageTimeSeconds =
        data.reduce(
        (sum, a) => sum + (a.time_used_seconds ?? 0),
        0
        ) / totalAttempts;

    res.json({
        totalAttempts,
        averageAccuracy: Number(averageAccuracy.toFixed(2)),
        bestScore,
        averageTimeSeconds: Math.floor(averageTimeSeconds)
    });
})
.get('/material/:title', requireAuth, async (req, res) => {
    const { title } = req.params;

    const { data } = await supabaseAdmin
        .from('attempts')
        .select('score, accuracy')
        .eq('user_id', req.user!.id)
        .eq('material_title', title)
        .not('completed_at', 'is', null);

    if (!data || data.length === 0) {
        return res.json({
        materialTitle: title,
        attempts: 0,
        bestScore: 0,
        averageAccuracy: 0
        });
    }

    const attempts = data.length;
    const bestScore = Math.max(...data.map(a => a.score ?? 0));
    const averageAccuracy =
        data.reduce((s, a) => s + (a.accuracy ?? 0), 0) / attempts;

    res.json({
        materialTitle: title,
        attempts,
        bestScore,
        averageAccuracy: Number(averageAccuracy.toFixed(2))
    });
})
.get('/type', requireAuth, async (req, res) => {
    const { data } = await supabaseAdmin
        .from('attempts')
        .select('question_type, accuracy')
        .eq('user_id', req.user!.id)
        .not('completed_at', 'is', null);

    const grouped: Record<string, { total: number; count: number }> = {};

    data?.forEach(a => {
        const type = a.question_type ?? 'ALL';

        if (!grouped[type]) {
        grouped[type] = { total: 0, count: 0 };
        }

        grouped[type].total += a.accuracy ?? 0;
        grouped[type].count += 1;
    });

    const result = Object.entries(grouped).map(
        ([type, stats]) => ({
        questionType: type,
        averageAccuracy: Number(
            (stats.total / stats.count).toFixed(2)
        )
        })
    );

    res.json(result);
})
.get('/history', requireAuth, async (req, res) => {
    const { data } = await supabaseAdmin
        .from('attempts')
        .select(
        'created_at, score, accuracy, time_used_seconds'
        )
        .eq('user_id', req.user!.id)
        .not('completed_at', 'is', null)
        .order('created_at', { ascending: true });

    res.json(
        data?.map(a => ({
        date: a.created_at,
        score: a.score,
        accuracy: a.accuracy,
        timeUsed: a.time_used_seconds
        })) ?? []
    );
})
.get('/topics', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin.rpc(
    'topic_accuracy',
    { uid: req.user!.id }
  );

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
})
.get('/weak-topics', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin.rpc(
    'weak_topics',
    { uid: req.user!.id }
  );

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
})
.get('/retakes', requireAuth, async (req, res) => {
  const { materialTitle, type } = req.query;

  if (!materialTitle) {
    return res.status(400).json({ error: 'materialTitle required' });
  }

  let q = supabaseAdmin
    .from('attempts')
    .select('id, score, accuracy, completed_at')
    .eq('user_id', req.user!.id)
    .eq('material_title', materialTitle)
    .order('completed_at', { ascending: true });

  if (type) {
    q = q.eq('question_type', type);
  }

  const { data } = await q;
  console.log("attempts", data, materialTitle, type, q.eq("question_type", type));
  

  if (!data || data.length < 2) {
    return res.json({
      message: 'Not enough attempts for comparison'
    });
  }

  const improvement =
    data[data.length - 1].score - data[0].score;

  res.json({
    attempts: data,
    improvement,
    trend:
      improvement > 0
        ? 'IMPROVING'
        : improvement < 0
        ? 'DECLINING'
        : 'STAGNANT'
  });
})
export default router;