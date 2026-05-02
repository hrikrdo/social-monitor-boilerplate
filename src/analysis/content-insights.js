const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-5';

// Spanish stopwords for word cloud
const STOPWORDS = new Set([
  'a', 'al', 'algo', 'algun', 'alguna', 'algunas', 'alguno', 'algunos', 'ante', 'antes', 'aqui', 'asi', 'aun',
  'bastante', 'bien', 'como', 'con', 'cuando', 'cual', 'cuales', 'de', 'del', 'desde', 'donde', 'dos', 'e',
  'el', 'ella', 'ellas', 'ellos', 'en', 'entre', 'era', 'es', 'esa', 'esas', 'ese', 'eso', 'esos', 'esta',
  'estado', 'estan', 'estar', 'estas', 'este', 'esto', 'estos', 'estoy', 'ha', 'han', 'hasta', 'hay', 'la',
  'las', 'lo', 'los', 'mas', 'me', 'mi', 'mis', 'mucho', 'muy', 'ni', 'no', 'nos', 'nosotros', 'o', 'otra',
  'otras', 'otro', 'otros', 'para', 'pero', 'poco', 'por', 'porque', 'que', 'quien', 'quienes', 'se', 'segun',
  'ser', 'si', 'siempre', 'sin', 'sobre', 'solo', 'son', 'su', 'sus', 'tambien', 'tanto', 'te', 'tengo',
  'tener', 'ti', 'tiene', 'todo', 'todos', 'tras', 'tu', 'tus', 'un', 'una', 'unas', 'unos', 'va', 'vamos',
  'y', 'ya', 'yo', 'vos', 'este', 'esta', 'este', 'esta', 'fue', 'o', 'u', 'e', 'le', 'les', 'nada',
  'pues', 'mismo', 'aun', 'solo', 'tal', 'estar', 'hace', 'hacer', 'cada', 'bien', 'mas', 'si', 'ok',
  'buen', 'buena', 'bueno', 'buenas', 'buenos', 'jaja', 'jajaja', 'jjj', 'the', 'to', 'and', 'of', 'in', 'is'
]);

function generateWordCloud(comments) {
  const wordCounts = {};
  for (const c of comments) {
    if (!c.text) continue;
    // Extract words (keep letters, accented chars, numbers)
    const words = c.text.toLowerCase()
      .replace(/[^\wáéíóúñü\s]/gi, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
    for (const w of words) {
      wordCounts[w] = (wordCounts[w] || 0) + 1;
    }
  }
  return Object.entries(wordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([word, count]) => ({ word, count }));
}

async function analyzeComments(comments, postsContext = []) {
  if (comments.length === 0) {
    return { status: 'no_data', message: 'Sin comentarios para analizar' };
  }

  // Prepare comments text
  const commentsText = comments.map((c, i) => {
    const sentiment = c.sentiment ? `[${c.sentiment}]` : '';
    return `${i + 1}. ${sentiment} ${c.text?.slice(0, 300) || ''}`;
  }).join('\n');

  const postsText = postsContext.map((p, i) => `Post ${i + 1}: ${p.caption?.slice(0, 200) || ''}`).join('\n');

  const clientName = process.env.CLIENT_NAME || 'la marca';
  const clientLocation = process.env.CLIENT_LOCATION || 'Latinoamerica';
  const clientDescription = process.env.CLIENT_DESCRIPTION || 'una marca con presencia en redes sociales';

  const systemPrompt = `Eres un experto en analisis de redes sociales y estrategia de contenido para marcas de Latinoamerica, especificamente ${clientLocation}. Tu tarea es analizar comentarios de Instagram y Facebook de ${clientName}, ${clientDescription}.

Debes identificar patrones, objeciones comunes, intereses reales y generar ideas de contenido accionables para el equipo de marketing.

Tu respuesta DEBE ser un JSON valido (sin markdown, sin texto adicional) con esta estructura exacta:

{
  "top_themes": [
    {
      "title": "Nombre corto del tema",
      "description": "Descripcion de 1-2 frases",
      "percentage": 35,
      "mentions": 45,
      "example_comments": ["cita 1", "cita 2", "cita 3"],
      "keywords": ["palabra1", "palabra2", "palabra3"],
      "sentiment": "positivo|negativo|neutro|mixto"
    }
  ],
  "frequent_questions": [
    {
      "question": "Pregunta que se repite",
      "count": 12,
      "suggested_answer": "Respuesta sugerida breve"
    }
  ],
  "content_ideas": [
    {
      "title": "Titulo de la idea",
      "format": "reel|post|historia|video|carrusel",
      "description": "Que debe mostrar/contar el contenido",
      "hook": "Frase gancho de apertura",
      "reasoning": "Por que funcionaria basado en los comentarios"
    }
  ],
  "insights_summary": "Parrafo de 3-4 lineas con el insight principal que el equipo de marketing debe saber"
}

REGLAS:
- top_themes: exactamente 3 temas principales
- frequent_questions: hasta 5 preguntas mas comunes
- content_ideas: exactamente 4 ideas concretas y accionables
- Ejemplos de comentarios: usa comentarios REALES del input (transcribe textualmente, max 100 chars)
- Todo en espanol neutro con tono natural de ${clientLocation}
- Sin emojis en las keys del JSON, solo en los valores si aparecen en los comentarios originales`;

  const userMessage = `Analiza estos ${comments.length} comentarios de ${clientName}:

CONTEXTO DE LAS PUBLICACIONES (a que contenido estan respondiendo):
${postsText}

COMENTARIOS:
${commentsText}

Genera el analisis completo en JSON.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: [
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }
    ],
    messages: [
      { role: 'user', content: userMessage }
    ]
  });

  const content = response.content[0]?.text || '';

  // Parse JSON response
  let parsed;
  try {
    // Try to extract JSON (in case there's any extra text)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : content;
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    console.error('[Insights] JSON parse error. Raw response:', content.slice(0, 500));
    throw new Error('Claude returned invalid JSON');
  }

  return {
    status: 'completed',
    analysis: parsed,
    tokens_used: {
      input: response.usage?.input_tokens || 0,
      cached_input: response.usage?.cache_read_input_tokens || 0,
      output: response.usage?.output_tokens || 0
    }
  };
}

async function generateInsights(db, windowDays = 30) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  // Get comments within window
  const comments = db.getDb().prepare(`
    SELECT c.text, c.sentiment, c.category, c.author, c.created_at, p.caption as post_caption
    FROM comments c
    LEFT JOIN posts p ON c.post_id = p.post_id
    WHERE c.text IS NOT NULL AND c.text != '' AND c.created_at >= ?
    ORDER BY c.created_at DESC
    LIMIT 500
  `).all(cutoff);

  if (comments.length === 0) {
    return { status: 'no_data', message: 'Sin comentarios en el periodo' };
  }

  // Get posts context (top commented)
  const posts = db.getDb().prepare(`
    SELECT caption FROM posts
    WHERE caption IS NOT NULL AND caption != ''
    ORDER BY comments_count DESC LIMIT 5
  `).all();

  // Generate word cloud locally (no cost)
  const wordCloud = generateWordCloud(comments);

  // Call Claude for thematic analysis
  const result = await analyzeComments(comments, posts);

  if (result.status !== 'completed') return result;

  return {
    status: 'completed',
    total_comments: comments.length,
    analysis: result.analysis,
    word_cloud: wordCloud,
    tokens_used: result.tokens_used,
    window_days: windowDays,
    generated_at: new Date().toISOString()
  };
}

module.exports = { generateInsights, generateWordCloud };
