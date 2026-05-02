// Keyword-based sentiment analysis for Spanish comments (Glasscare Panama context)

const CATEGORIES = {
  interes_compra: {
    keywords: [
      'quiero', 'precio', 'costo', 'cuánto', 'cuanto', 'vale', 'cobran',
      'dónde', 'donde', 'ubicación', 'ubicacion', 'dirección', 'direccion',
      'contacto', 'número', 'numero', 'whatsapp', 'wsp', 'cel',
      'disponible', 'agendar', 'cita', 'reservar', 'comprar', 'adquirir',
      'instalar', 'cotización', 'cotizacion', 'cotizar', 'proforma',
      'me interesa', 'info', 'información', 'informacion', 'dm', 'inbox',
      'sucursal', 'horario', 'atienden', 'trabajan', 'aplican'
    ],
    label: 'Interes de compra'
  },
  preguntas: {
    keywords: [
      'qué es', 'que es', 'cómo funciona', 'como funciona', 'cómo es', 'como es',
      'cuánto dura', 'cuanto dura', 'garantía', 'garantia', 'duración', 'duracion',
      'sirve para', 'protege', 'resiste', 'material', 'micras',
      'diferencia', 'tipos', 'modelos', 'marcas', 'versus', 'vs',
      'se puede', 'se nota', 'afecta', 'daña', 'oscurece',
      'qué incluye', 'que incluye', 'viene con', 'trae'
    ],
    label: 'Preguntas'
  },
  elogios: {
    keywords: [
      'increíble', 'increible', 'excelente', 'genial', 'espectacular',
      'me encanta', 'encanta', 'hermoso', 'brutal', 'fino',
      'buenísimo', 'buenisimo', 'buenazo', 'chevere', 'chévere',
      'recomiendo', 'recomendado', 'lo mejor', 'calidad', 'profesional',
      'buen trabajo', 'felicidades', 'felicitaciones', 'crack',
      'top', 'fire', 'perfecto', 'impecable', 'wow', 'dios mío',
      'que lindo', 'qué lindo', 'tremendo', 'bien', 'super',
      'me gusta', 'like', 'amor', 'love', 'beautiful'
    ],
    label: 'Elogios'
  },
  quejas: {
    keywords: [
      'caro', 'costoso', 'mucho dinero', 'robo', 'estafa', 'timo',
      'malo', 'pésimo', 'pesimo', 'horrible', 'basura', 'porquería',
      'no sirve', 'no funciona', 'se daña', 'se pela', 'burbuja',
      'decepción', 'decepcion', 'arrepentido', 'problema', 'reclamo',
      'queja', 'peor', 'engaño', 'engano', 'mentira', 'falso',
      'no recomiendo', 'cuidado', 'pilas', 'fraude'
    ],
    label: 'Quejas'
  },
  sugerencias: {
    keywords: [
      'deberían', 'deberian', 'sería bueno', 'seria bueno',
      'ojalá', 'ojala', 'podrían', 'podrian', 'sugiero',
      'mejorar', 'falta', 'agregar', 'incluir', 'necesitan',
      'sería genial', 'estaría bien', 'propongo', 'idea',
      'por qué no', 'porque no'
    ],
    label: 'Sugerencias'
  }
};

const POSITIVE_WORDS = [
  'bueno', 'excelente', 'genial', 'increíble', 'increible', 'perfecto', 'hermoso',
  'me encanta', 'encanta', 'recomiendo', 'top', 'calidad', 'profesional',
  'impecable', 'brutal', 'espectacular', 'tremendo', 'super', 'chevere',
  'felicidades', 'amor', 'love', 'like', 'me gusta', 'wow', 'fire',
  'gracias', 'bien', 'fino', 'crack', 'buen', 'buenísimo', 'buenisimo',
  'lindo', 'bonito', 'nice', 'cool', 'great', 'amazing', 'awesome',
  '👏', '🔥', '❤️', '😍', '💯', '👍', '🙌', '💪', '✨', '⭐'
];

const NEGATIVE_WORDS = [
  'malo', 'pésimo', 'pesimo', 'horrible', 'basura', 'caro', 'costoso',
  'no sirve', 'no funciona', 'estafa', 'robo', 'engaño', 'mentira',
  'decepción', 'decepcion', 'problema', 'queja', 'reclamo', 'peor',
  'arrepentido', 'fraude', 'timo', 'porquería',
  '👎', '😡', '🤬', '😤', '💩', '🙄'
];

function normalizeText(text) {
  return text.toLowerCase().trim();
}

function isSpam(text) {
  const normalized = normalizeText(text);
  // Only emojis or very short
  if (normalized.length < 3) return true;
  // Only a tag (@someone)
  if (/^@\w+\s*$/.test(normalized)) return true;
  // Contains suspicious links
  if (/bit\.ly|tinyurl|goo\.gl|click here|free money/i.test(normalized)) return true;
  // Only emojis
  const withoutEmojis = normalized.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2702}-\u{27B0}\u{24C2}-\u{1F251}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\s]/gu, '');
  if (withoutEmojis.length === 0) return true;
  return false;
}

function detectCategory(text) {
  const normalized = normalizeText(text);

  if (isSpam(text)) return 'Spam';

  // Check each category by keyword matches - return first with most matches
  let bestCategory = null;
  let bestScore = 0;

  for (const [key, cat] of Object.entries(CATEGORIES)) {
    let score = 0;
    for (const kw of cat.keywords) {
      if (normalized.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = cat.label;
    }
  }

  return bestCategory || 'General';
}

function detectSentiment(text) {
  const normalized = normalizeText(text);

  if (isSpam(text)) return 'neutro';

  let positiveScore = 0;
  let negativeScore = 0;

  for (const word of POSITIVE_WORDS) {
    if (normalized.includes(word)) positiveScore++;
  }
  for (const word of NEGATIVE_WORDS) {
    if (normalized.includes(word)) negativeScore++;
  }

  if (positiveScore > negativeScore) return 'positivo';
  if (negativeScore > positiveScore) return 'negativo';
  if (positiveScore === 0 && negativeScore === 0) {
    // Check if it's a question (likely neutral)
    if (normalized.includes('?')) return 'neutro';
    return 'neutro';
  }
  return 'neutro';
}

function analyze(text) {
  return {
    sentiment: detectSentiment(text),
    category: detectCategory(text)
  };
}

module.exports = { analyze, detectSentiment, detectCategory };
