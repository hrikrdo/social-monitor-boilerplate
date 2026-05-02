// ============================================================================
// Social Monitor Dashboard — Editorial design system
// Multi-tenant boilerplate (client config loaded from /api/config)
// ============================================================================

// --- State ---
let selectedPostId = null;
let currentAdsSort = 'link_clicks';
let charts = {};
let activeKpiFilter = null;
let lastDashboardData = null;
let clientConfig = null;

// --- Load client config & inject branding ---
async function loadClientConfig() {
  try {
    const cfg = await fetch('/api/config').then(r => r.json());
    clientConfig = cfg;
    // Inject brand into DOM
    document.title = `${cfg.clientName} · ${cfg.clientTagline}`;
    const brandH1 = document.querySelector('.header-left h1');
    const brandSub = document.querySelector('.header-left .subtitle');
    if (brandH1) brandH1.textContent = cfg.clientName;
    if (brandSub) brandSub.textContent = cfg.clientTagline;
    const footer = document.querySelector('.app-footer .footer-brand');
    if (footer) footer.textContent = `${cfg.clientName} · Dashboard interno`;
    // Apply brand color to CSS vars (light + dark)
    if (cfg.brandColor) {
      document.documentElement.style.setProperty('--glasscare-green', cfg.brandColor);
    }
    if (cfg.brandColorDeep) {
      document.documentElement.style.setProperty('--glasscare-green-deep', cfg.brandColorDeep);
    }
  } catch (e) {
    console.warn('Could not load client config:', e);
  }
}

// --- Color palette (read from CSS vars at runtime so dark/light works) ---
function readCssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

let COLORS = {};
function refreshColors() {
  COLORS = {
    ink:       readCssVar('--ink', '#181d26'),
    body:      readCssVar('--body', '#333840'),
    muted:     readCssVar('--muted', '#6b7280'),
    hairline:  readCssVar('--chart-grid', '#e5e7eb'),
    canvas:    readCssVar('--canvas', '#ffffff'),
    surface:   readCssVar('--surface-soft', '#f8fafc'),
    green:     readCssVar('--glasscare-green', '#00d750'),
    greenDim:  readCssVar('--glasscare-green-dim', '#00b342'),
    greenDeep: readCssVar('--glasscare-green-deep', '#0a3d18'),
    greenSoft: readCssVar('--glasscare-green-soft', '#d8f5e2'),
    cyan:      readCssVar('--glasscare-cyan', '#29e6c5'),
    positive:  readCssVar('--positive', '#006a2c'),
    negative:  readCssVar('--negative', '#b91c1c'),
    neutral:   readCssVar('--neutral', '#b45309'),
    link:      readCssVar('--link', '#1b61c9'),
    coral:     readCssVar('--signature-coral', '#aa2d00'),
    tooltipBg: readCssVar('--chart-tooltip-bg', '#181d26'),
    tooltipText: readCssVar('--chart-tooltip-text', '#ffffff')
  };

  // Update Chart.js global defaults
  Chart.defaults.color = COLORS.muted;
  Chart.defaults.borderColor = COLORS.hairline;
}
refreshColors();

Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
Chart.defaults.font.size = 11;

// --- Theme toggle ---
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('monitor-theme', next);
  refreshColors();
  // Re-render all charts with new colors
  if (lastDashboardData) {
    Object.keys(charts).forEach(destroyChart);
    loadDashboard();
  }
}

// --- Tabs ---
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'insights') loadInsights();
  });
});

// --- Sort Buttons ---
document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentAdsSort = btn.dataset.sort;
    loadAds();
  });
});

// --- Helpers ---
function alpha(hex, a) {
  if (!hex) return `rgba(0,0,0,${a})`;
  const h = hex.replace('#', '').trim();
  if (h.length !== 6) return hex;
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function fmt(n) { return new Intl.NumberFormat('es-PA').format(Math.round(n || 0)); }
function fmtCompact(n) {
  if (!n) return '0';
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'k';
  return Math.round(n).toString();
}
function fmtMoney(n) { return '$' + parseFloat(n || 0).toFixed(2); }
function fmtPct(n) { return parseFloat(n || 0).toFixed(2) + '%'; }
function el(id) { return document.getElementById(id); }
function destroyChart(key) { if (charts[key]) { charts[key].destroy(); delete charts[key]; } }

// --- API ---
async function api(path) { const res = await fetch(path); return res.json(); }

// ============================================================================
// LOAD DASHBOARD (main entrypoint)
// ============================================================================
async function loadDashboard() {
  const [overview, daily, timeline] = await Promise.all([
    api('/api/dashboard'),
    api('/api/daily-insights?type=campaign'),
    api('/api/sentiment-timeline')
  ]);

  lastDashboardData = { overview, daily, timeline };

  // Last sync
  el('lastSync').textContent = overview.lastSync
    ? new Date(overview.lastSync + 'Z').toLocaleString('es-PA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'Nunca';

  // ----- Compute period & deltas -----
  const periodMeta = computePeriodMeta(daily);
  const deltas = computeDeltas(daily);

  el('overview-period').textContent = periodMeta.label;

  // ----- Overview KPIs -----
  const ads = overview.adsTotals || {};
  el('kpi-spend').textContent = fmtMoney(ads.total_spend);
  el('kpi-spend-sub').innerHTML = renderDelta(deltas.spend, '$', false) + ' vs periodo previo';
  el('kpi-reach').textContent = fmtCompact(ads.total_reach);
  el('kpi-reach-sub').innerHTML = renderDelta(deltas.reach, '', false) + ' vs periodo previo';
  el('kpi-clicks').textContent = fmt(ads.total_link_clicks);
  el('kpi-clicks-sub').innerHTML = renderDelta(deltas.clicks, '', false) + ' vs periodo previo';
  el('kpi-cpc').textContent = fmtMoney(overview.avgCpc);
  el('kpi-cpc-sub').innerHTML = renderDelta(deltas.cpc, '$', true) + ' (mejor si baja)';
  el('kpi-comments').textContent = fmt(overview.totalComments);

  // Sparklines
  drawSparkline('spark-spend', daily.map(d => d.spend), COLORS.ink);
  drawSparkline('spark-reach', daily.map(d => d.reach), COLORS.cyan);
  drawSparkline('spark-clicks', daily.map(d => d.link_clicks), COLORS.green);
  drawSparkline('spark-cpc', daily.map(d => d.cpc || 0), COLORS.coral, true);

  // ----- Sentiment -----
  const sentDist = overview.sentimentDist || [];
  const pos = sentDist.find(s => s.sentiment === 'positivo')?.count || 0;
  const neg = sentDist.find(s => s.sentiment === 'negativo')?.count || 0;
  const neu = sentDist.find(s => s.sentiment === 'neutro')?.count || 0;
  const total = pos + neg + neu;
  const acceptance = total > 0 ? Math.round((pos / total) * 100) : 0;
  const netScore = total > 0 ? Math.round((pos - neg) / total * 100) : 0;

  el('kpi-acceptance').textContent = acceptance + '%';
  const fill = el('acceptance-fill');
  fill.style.width = acceptance + '%';
  fill.style.background = acceptance >= 60 ? COLORS.green : acceptance >= 40 ? COLORS.neutral : COLORS.negative;

  el('kpi-positive').textContent = `${fmt(pos)} (${total > 0 ? Math.round(pos/total*100) : 0}%)`;
  el('kpi-negative').textContent = `${fmt(neg)} (${total > 0 ? Math.round(neg/total*100) : 0}%)`;
  el('kpi-neutral').textContent = `${fmt(neu)} (${total > 0 ? Math.round(neu/total*100) : 0}%)`;

  const catDist = overview.categoryDist || [];
  const purchaseIntent = catDist.find(c => c.category === 'Interes de compra')?.count || 0;
  const intentPct = total > 0 ? Math.round(purchaseIntent/total*100) : 0;
  el('kpi-purchase-intent').textContent = intentPct + '%';
  el('kpi-purchase-overview').textContent = intentPct + '%';
  el('kpi-purchase-count').textContent = `${fmt(purchaseIntent)} comentarios con intención`;
  el('kpi-comments-sub').textContent = `${fmt(total)} clasificados con IA`;

  // ----- Auto narrative -----
  el('overview-narrative').textContent = generateNarrative({ ads, deltas, acceptance, intentPct, totalComments: total });
  el('overview-lede').textContent = generateLede({ ads, periodMeta, intentPct });

  // Sentiment narrative
  el('sentiment-narrative').textContent = generateSentimentNarrative({ pos, neg, neu, netScore, intentPct });

  // Ads narrative
  el('ads-narrative').textContent = generateAdsNarrative({ ads, deltas });

  // ----- Funnel -----
  drawFunnel(ads, purchaseIntent);

  // ----- Charts -----
  drawSentimentBars('chartSentimentOverview', pos, neg, neu);
  drawSpendReach(daily);
  drawCategoryBars(catDist);
  drawSentimentTimeline(timeline);

  // ----- Ads Performance KPIs -----
  el('ads-spend').textContent = fmtMoney(ads.total_spend);
  el('ads-reach').textContent = fmtCompact(ads.total_reach);
  el('ads-impressions').textContent = fmtCompact(ads.total_impressions);
  el('ads-clicks').textContent = fmt(ads.total_link_clicks);
  const ctrPct = ads.total_impressions > 0 ? (ads.total_link_clicks / ads.total_impressions * 100) : 0;
  el('ads-ctr').textContent = ctrPct.toFixed(2) + '%';
  el('ads-ctr-vs').innerHTML = ctrBenchmark(ctrPct);
  el('ads-cpr').textContent = ads.total_link_clicks > 0
    ? fmtMoney(ads.total_spend / ads.total_link_clicks) : '$0.00';

  drawDailySpend(daily);
  drawDailyCpc(daily);
  drawReachImpressions(daily);

  loadCampaigns();
  loadPosts();
  loadAds();
  loadBestAd();
  generateActionItems({ ads, deltas, acceptance, intentPct, total, neg });
}

// ============================================================================
// AUTO-NARRATIVE GENERATION
// ============================================================================

function computePeriodMeta(daily) {
  if (!daily || daily.length === 0) return { label: 'Sin datos del periodo', days: 0 };
  const days = daily.length;
  const start = daily[0].date;
  const end = daily[daily.length - 1].date;
  return { label: `${days} días · ${formatRange(start, end)}`, days, start, end };
}

function formatRange(start, end) {
  if (!start || !end) return '';
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d) => d.toLocaleDateString('es-PA', { day: '2-digit', month: 'short' });
  return `${fmt(s)} – ${fmt(e)}`;
}

function computeDeltas(daily) {
  if (!daily || daily.length < 4) return { spend: null, reach: null, clicks: null, cpc: null };
  // Split in halves
  const mid = Math.floor(daily.length / 2);
  const prev = daily.slice(0, mid);
  const curr = daily.slice(mid);
  const sumSafe = (arr, key) => arr.reduce((a, b) => a + (b[key] || 0), 0);
  const avgSafe = (arr, key) => {
    const v = arr.filter(x => x[key] > 0).map(x => x[key]);
    return v.length > 0 ? v.reduce((a,b) => a+b, 0) / v.length : 0;
  };
  const pct = (curr, prev) => prev > 0 ? Math.round((curr - prev) / prev * 100) : null;

  return {
    spend: pct(sumSafe(curr, 'spend'), sumSafe(prev, 'spend')),
    reach: pct(sumSafe(curr, 'reach'), sumSafe(prev, 'reach')),
    clicks: pct(sumSafe(curr, 'link_clicks'), sumSafe(prev, 'link_clicks')),
    cpc: pct(avgSafe(curr, 'cpc'), avgSafe(prev, 'cpc'))
  };
}

function renderDelta(pct, prefix, invertedSemantic) {
  if (pct === null || pct === undefined || isNaN(pct)) return '<span class="kpi-delta flat">— sin datos</span>';
  const cls = pct === 0 ? 'flat' : (invertedSemantic ? (pct < 0 ? 'up' : 'down') : (pct > 0 ? 'up' : 'down'));
  const arrow = pct === 0 ? '→' : pct > 0 ? '↑' : '↓';
  return `<span class="kpi-delta ${cls}">${arrow} ${Math.abs(pct)}%</span>`;
}

function generateNarrative({ ads, deltas, acceptance, intentPct, totalComments }) {
  const parts = [];
  if (deltas.clicks !== null && Math.abs(deltas.clicks) >= 10) {
    parts.push(`Los clics ${deltas.clicks > 0 ? 'crecieron' : 'bajaron'} ${Math.abs(deltas.clicks)}%`);
  }
  if (deltas.cpc !== null && Math.abs(deltas.cpc) >= 10) {
    parts.push(`mientras el CPC ${deltas.cpc > 0 ? 'subió' : 'mejoró'} ${Math.abs(deltas.cpc)}%`);
  }
  if (parts.length === 0) {
    if (intentPct >= 30) {
      return `${intentPct}% de los comentarios muestran intención de compra — la demanda es real.`;
    } else if (acceptance >= 70) {
      return `La aceptación es de ${acceptance}% positivo — la marca está siendo bien recibida.`;
    } else if (totalComments > 0) {
      return `${fmt(totalComments)} comentarios analizados con IA en el último periodo.`;
    }
    return `${fmtMoney(ads.total_spend || 0)} invertidos · ${fmtCompact(ads.total_reach || 0)} personas alcanzadas.`;
  }
  return parts.join(' ') + '.';
}

function generateLede({ ads, periodMeta, intentPct }) {
  const reach = fmtCompact(ads.total_reach || 0);
  const spend = fmtMoney(ads.total_spend || 0);
  const clicks = fmt(ads.total_link_clicks || 0);
  return `${spend} invertidos en ${periodMeta.days} días, ${reach} personas alcanzadas y ${clicks} clics en enlace. Interés de compra detectado en ${intentPct}% de las conversaciones.`;
}

function generateSentimentNarrative({ pos, neg, neu, netScore, intentPct }) {
  const total = pos + neg + neu;
  if (total === 0) return 'Aún no hay comentarios para analizar.';
  if (intentPct >= 25) {
    return `${intentPct}% de las conversaciones muestran intención de compra real — la demanda existe.`;
  }
  if (netScore >= 30) return `Score neto de ${netScore}: la marca tiene amplia aceptación positiva.`;
  if (netScore <= -10) return `Score neto de ${netScore}: hay más críticas que elogios. Revisa los comentarios negativos.`;
  return `Score neto de ${netScore}. La conversación es mayormente neutra (${Math.round(neu/total*100)}%).`;
}

function generateAdsNarrative({ ads, deltas }) {
  const ctr = ads.total_impressions > 0 ? (ads.total_link_clicks / ads.total_impressions * 100) : 0;
  if (ctr >= 2) return `CTR de ${ctr.toFixed(2)}% — performance excelente, por encima del benchmark Meta.`;
  if (ctr >= 0.9) return `CTR de ${ctr.toFixed(2)}% — performance dentro del rango normal de Meta (0.9%-1.5%).`;
  if (ctr > 0) return `CTR de ${ctr.toFixed(2)}% — por debajo del benchmark. Vale la pena revisar creativos y audiencias.`;
  return `Cargando métricas de performance...`;
}

function ctrBenchmark(ctr) {
  if (ctr >= 2) return '<span class="kpi-delta up">excelente</span>';
  if (ctr >= 0.9) return '<span class="kpi-delta up">en rango</span>';
  if (ctr > 0) return '<span class="kpi-delta down">bajo</span>';
  return '';
}

// ============================================================================
// FUNNEL
// ============================================================================
function drawFunnel(ads, purchaseIntent) {
  const imp = ads.total_impressions || 0;
  const reach = ads.total_reach || 0;
  const clicks = ads.total_link_clicks || 0;
  el('funnel-impressions').textContent = fmtCompact(imp);
  el('funnel-reach').textContent = fmtCompact(reach);
  el('funnel-clicks').textContent = fmt(clicks);
  el('funnel-intent').textContent = fmt(purchaseIntent);
  el('funnel-reach-rate').textContent = imp > 0 ? Math.round(reach / imp * 100) + '%' : '0%';
  el('funnel-ctr').textContent = imp > 0 ? (clicks / imp * 100).toFixed(2) + '%' : '0%';
  el('funnel-intent-rate').textContent = clicks > 0 ? Math.round(purchaseIntent / clicks * 100) + '%' : '—';
}

// ============================================================================
// SPARKLINES
// ============================================================================
function drawSparkline(canvasId, data, color, fillBelow) {
  destroyChart(canvasId);
  const canvas = el(canvasId);
  if (!canvas || !data || data.length === 0) return;
  charts[canvasId] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: data.map((_, i) => i),
      datasets: [{
        data,
        borderColor: color,
        backgroundColor: fillBelow ? 'rgba(170,45,0,0.06)' : 'transparent',
        fill: !!fillBelow,
        borderWidth: 1.5,
        tension: 0.35,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
      elements: { line: { borderJoinStyle: 'round' } }
    }
  });
}

// ============================================================================
// ACTION ITEMS (auto-detected)
// ============================================================================
function generateActionItems({ ads, deltas, acceptance, intentPct, total, neg }) {
  const items = [];

  // Issue 1: Pending questions
  if (intentPct >= 20) {
    items.push({
      title: 'Comentarios con interés de compra sin responder',
      detail: `${intentPct}% de los comentarios preguntan precio, ubicación o cómo agendar. Cada respuesta es una venta potencial — revisa la pestaña Sentimiento para responder.`
    });
  }

  // Issue 2: CPC trending up
  if (deltas.cpc !== null && deltas.cpc > 15) {
    items.push({
      title: `El CPC subió ${deltas.cpc}% en la segunda mitad del periodo`,
      detail: 'Posible saturación de audiencia o creativo cansado. Considera refrescar el copy o ampliar el targeting.'
    });
  } else if (deltas.cpc !== null && deltas.cpc < -15) {
    items.push({
      title: `El CPC mejoró ${Math.abs(deltas.cpc)}% — ¡aprovecha!`,
      detail: 'Es buen momento para escalar la inversión en las campañas que están performando.'
    });
  }

  // Issue 3: Negative sentiment elevated
  if (total > 0 && neg / total > 0.15) {
    items.push({
      title: `${Math.round(neg/total*100)}% de comentarios negativos`,
      detail: 'Por encima del umbral saludable (15%). Revisa qué temas están generando críticas en los Insights AI.'
    });
  }

  // Issue 4: Low CTR
  const ctrPct = ads.total_impressions > 0 ? (ads.total_link_clicks / ads.total_impressions * 100) : 0;
  if (ctrPct > 0 && ctrPct < 0.7) {
    items.push({
      title: 'CTR por debajo del benchmark Meta',
      detail: `Tu CTR es ${ctrPct.toFixed(2)}%, el benchmark Meta saludable es 0.9%-1.5%. El creativo o la audiencia necesitan ajuste.`
    });
  }

  // Issue 5: Acceptance high
  if (acceptance >= 70 && intentPct >= 20) {
    items.push({
      title: 'Excelente combinación: aceptación + intención',
      detail: `${acceptance}% positivo y ${intentPct}% con intención de compra. Es el momento ideal para escalar la inversión.`
    });
  }

  // If nothing found
  if (items.length === 0) {
    el('action-items-section').style.display = 'none';
    return;
  }

  // Render
  el('action-items-section').style.display = 'block';
  const grid = el('action-items-grid');
  grid.innerHTML = items.slice(0, 3).map((item, i) => `
    <div class="action-item">
      <div class="action-item-num">Acción ${String(i + 1).padStart(2, '0')}</div>
      <div class="action-item-title">${escapeHtml(item.title)}</div>
      <div class="action-item-detail">${escapeHtml(item.detail)}</div>
    </div>
  `).join('');
  if (items.length === 1) el('action-items-title').textContent = 'Una cosa que requiere tu atención';
  else if (items.length === 2) el('action-items-title').textContent = 'Dos cosas que requieren tu atención';
  else el('action-items-title').textContent = 'Tres cosas que requieren tu atención';
}

// ============================================================================
// CHARTS — Editorial palette
// ============================================================================

function drawSentimentBars(canvasId, pos, neg, neu) {
  destroyChart(canvasId);
  charts[canvasId] = new Chart(el(canvasId), {
    type: 'bar',
    data: {
      labels: ['Positivo', 'Negativo', 'Neutro'],
      datasets: [{
        data: [pos, neg, neu],
        backgroundColor: [COLORS.green, COLORS.negative, COLORS.neutral],
        borderWidth: 0,
        borderRadius: 4,
        barThickness: 28
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: COLORS.tooltipBg,
          titleColor: COLORS.tooltipText,
          bodyColor: COLORS.tooltipText,
          padding: 10,
          callbacks: {
            label: (ctx) => {
              const total = pos + neg + neu;
              const pct = total > 0 ? Math.round(ctx.raw / total * 100) : 0;
              return `${ctx.raw} comentarios (${pct}%)`;
            }
          }
        }
      },
      scales: {
        x: { grid: { color: COLORS.hairline, drawBorder: false }, beginAtZero: true, ticks: { color: COLORS.muted } },
        y: { grid: { display: false }, ticks: { font: { size: 12, weight: '500' }, color: COLORS.ink } }
      }
    }
  });
}

function drawSpendReach(daily) {
  destroyChart('chartSpendReach');
  const labels = daily.map(d => formatChartDate(d.date));
  charts.chartSpendReach = new Chart(el('chartSpendReach'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Inversión ($)',
          data: daily.map(d => d.spend),
          backgroundColor: alpha(COLORS.ink, 0.85),
          borderRadius: 3,
          yAxisID: 'y',
          order: 3
        },
        {
          label: 'Alcance',
          data: daily.map(d => d.reach),
          type: 'line',
          borderColor: COLORS.cyan,
          backgroundColor: alpha(COLORS.cyan, 0.10),
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          yAxisID: 'y1',
          order: 1
        },
        {
          label: 'Clics enlace',
          data: daily.map(d => d.link_clicks),
          type: 'line',
          borderColor: COLORS.green,
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          yAxisID: 'y',
          order: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: { position: 'left', grid: { color: COLORS.hairline, drawBorder: false }, ticks: { color: COLORS.muted, font: { size: 10 } } },
        y1: { position: 'right', grid: { display: false }, ticks: { color: COLORS.muted, font: { size: 10 }, callback: (v) => fmtCompact(v) } },
        x: { grid: { display: false }, ticks: { color: COLORS.muted, font: { size: 10 } } }
      },
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, color: COLORS.ink, font: { size: 11 }, padding: 16 } },
        tooltip: { backgroundColor: COLORS.tooltipBg, titleColor: COLORS.tooltipText, bodyColor: COLORS.tooltipText, padding: 10 }
      }
    }
  });
}

function drawCategoryBars(catDist) {
  destroyChart('chartCategories');
  const sorted = [...catDist].sort((a, b) => b.count - a.count);
  const palette = [COLORS.green, COLORS.cyan, COLORS.link, COLORS.coral, COLORS.neutral, '#7c3aed', COLORS.muted];
  charts.chartCategories = new Chart(el('chartCategories'), {
    type: 'bar',
    data: {
      labels: sorted.map(c => c.category),
      datasets: [{
        data: sorted.map(c => c.count),
        backgroundColor: sorted.map((_, i) => palette[i % palette.length]),
        borderWidth: 0,
        borderRadius: 4,
        barThickness: 22
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      onClick: (evt, elements) => {
        if (elements.length > 0) {
          const idx = elements[0].index;
          const category = sorted[idx].category;
          if (activeKpiFilter && activeKpiFilter.type === 'category' && activeKpiFilter.value === category) {
            activeKpiFilter = null;
            document.querySelectorAll('.kpi-filter').forEach(k => k.classList.remove('active-filter'));
            el('filterCategory').value = '';
            el('filterSentiment').value = '';
          } else {
            activeKpiFilter = { type: 'category', value: category };
            document.querySelectorAll('.kpi-filter').forEach(k => {
              k.classList.toggle('active-filter', k.dataset.filterType === 'category' && k.dataset.filterValue === category);
            });
            el('filterCategory').value = category;
            el('filterSentiment').value = '';
          }
          selectedPostId = null;
          loadPosts();
          loadComments();
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: COLORS.tooltipBg, titleColor: COLORS.tooltipText, bodyColor: COLORS.tooltipText, padding: 10, callbacks: { label: (ctx) => `${ctx.raw} comentarios` } }
      },
      scales: {
        x: { grid: { color: COLORS.hairline, drawBorder: false }, ticks: { color: COLORS.muted } },
        y: { grid: { display: false }, ticks: { font: { weight: '500', size: 11 }, color: COLORS.ink } }
      }
    }
  });
}

function drawSentimentTimeline(data) {
  destroyChart('chartSentimentTimeline');
  const dates = [...new Set(data.map(d => d.date))].sort();
  const positivo = dates.map(d => data.find(x => x.date === d && x.sentiment === 'positivo')?.count || 0);
  const negativo = dates.map(d => data.find(x => x.date === d && x.sentiment === 'negativo')?.count || 0);
  const neutro = dates.map(d => data.find(x => x.date === d && x.sentiment === 'neutro')?.count || 0);

  charts.chartSentimentTimeline = new Chart(el('chartSentimentTimeline'), {
    type: 'line',
    data: {
      labels: dates.map(formatChartDate),
      datasets: [
        { label: 'Positivo', data: positivo, borderColor: COLORS.green, backgroundColor: alpha(COLORS.green, 0.10), fill: true, tension: 0.35, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 },
        { label: 'Negativo', data: negativo, borderColor: COLORS.negative, backgroundColor: alpha(COLORS.negative, 0.08), fill: true, tension: 0.35, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 },
        { label: 'Neutro', data: neutro, borderColor: COLORS.neutral, backgroundColor: alpha(COLORS.neutral, 0.08), fill: true, tension: 0.35, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { color: COLORS.muted, font: { size: 10 } } },
        y: { grid: { color: COLORS.hairline, drawBorder: false }, beginAtZero: true, ticks: { color: COLORS.muted } }
      },
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, color: COLORS.ink, padding: 16 } },
        tooltip: { backgroundColor: COLORS.tooltipBg, titleColor: COLORS.tooltipText, bodyColor: COLORS.tooltipText, padding: 10 }
      }
    }
  });
}

function drawDailySpend(daily) {
  destroyChart('chartDailySpend');
  charts.chartDailySpend = new Chart(el('chartDailySpend'), {
    type: 'bar',
    data: {
      labels: daily.map(d => formatChartDate(d.date)),
      datasets: [{ label: 'Inversión ($)', data: daily.map(d => d.spend), backgroundColor: COLORS.ink, borderRadius: 3, barThickness: 16 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: COLORS.tooltipBg, titleColor: COLORS.tooltipText, bodyColor: COLORS.tooltipText, padding: 10 } },
      scales: {
        x: { grid: { display: false }, ticks: { color: COLORS.muted, font: { size: 10 } } },
        y: { grid: { color: COLORS.hairline, drawBorder: false }, ticks: { color: COLORS.muted, callback: (v) => '$' + v } }
      }
    }
  });
}

function drawDailyCpc(daily) {
  destroyChart('chartDailyCpc');
  charts.chartDailyCpc = new Chart(el('chartDailyCpc'), {
    type: 'line',
    data: {
      labels: daily.map(d => formatChartDate(d.date)),
      datasets: [{ label: 'CPC ($)', data: daily.map(d => d.cpc), borderColor: COLORS.coral, backgroundColor: alpha(COLORS.coral, 0.08), fill: true, tension: 0.35, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: COLORS.tooltipBg, titleColor: COLORS.tooltipText, bodyColor: COLORS.tooltipText, padding: 10 } },
      scales: {
        x: { grid: { display: false }, ticks: { color: COLORS.muted, font: { size: 10 } } },
        y: { grid: { color: COLORS.hairline, drawBorder: false }, ticks: { color: COLORS.muted, callback: (v) => '$' + v.toFixed(2) } }
      }
    }
  });
}

function drawReachImpressions(daily) {
  destroyChart('chartReachImpressions');
  charts.chartReachImpressions = new Chart(el('chartReachImpressions'), {
    type: 'line',
    data: {
      labels: daily.map(d => formatChartDate(d.date)),
      datasets: [
        { label: 'Alcance (personas únicas)', data: daily.map(d => d.reach), borderColor: COLORS.cyan, backgroundColor: alpha(COLORS.cyan, 0.12), fill: true, tension: 0.35, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 },
        { label: 'Impresiones (vistas totales)', data: daily.map(d => d.impressions), borderColor: COLORS.ink, backgroundColor: alpha(COLORS.ink, 0.08), fill: true, tension: 0.35, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { color: COLORS.muted, font: { size: 10 } } },
        y: { grid: { color: COLORS.hairline, drawBorder: false }, ticks: { color: COLORS.muted, callback: (v) => fmtCompact(v) } }
      },
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, color: COLORS.ink, padding: 16 } },
        tooltip: { backgroundColor: COLORS.tooltipBg, titleColor: COLORS.tooltipText, bodyColor: COLORS.tooltipText, padding: 10 }
      }
    }
  });
}

function formatChartDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-PA', { day: '2-digit', month: 'short' });
}

// ============================================================================
// POSTS / COMMENTS
// ============================================================================
async function loadPosts() {
  const posts = await api('/api/posts');
  const container = el('postsList');
  if (posts.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="icon">📰</div><p>Sin publicaciones. Sincroniza para cargar datos.</p></div>';
    return;
  }
  if (!selectedPostId && !activeKpiFilter && posts.length > 0) {
    selectedPostId = posts[0].post_id;
    loadComments();
  }
  container.innerHTML = posts.map(p => `
    <div class="post-card ${selectedPostId === p.post_id ? 'active' : ''}" onclick="selectPost('${p.post_id}')">
      <span class="platform-badge ${p.platform}">${p.platform}</span>
      <div class="post-caption">${escapeHtml(p.caption || 'Sin texto')}</div>
      <div class="post-metrics">
        <span class="metric-positive">+${p.positive || 0}</span>
        <span class="metric-negative">−${p.negative || 0}</span>
        <span>${p.comment_count || 0} comentarios</span>
      </div>
    </div>
  `).join('');
}

function selectPost(postId) {
  selectedPostId = selectedPostId === postId ? null : postId;
  loadPosts();
  loadComments();
}

async function loadComments() {
  const params = new URLSearchParams();
  if (selectedPostId) params.set('post_id', selectedPostId);
  const sentiment = el('filterSentiment').value;
  const category = el('filterCategory').value;
  if (sentiment) params.set('sentiment', sentiment);
  if (category) params.set('category', category);

  const comments = await api('/api/comments?' + params.toString());
  el('commentsCount').textContent = comments.length;
  const container = el('commentsList');
  if (comments.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>Sin comentarios.</p></div>';
    return;
  }
  container.innerHTML = comments.map(c => `
    <div class="comment-card">
      <div class="comment-author">@${escapeHtml(c.author)}</div>
      <div class="comment-text">${escapeHtml(c.text)}</div>
      <div class="comment-tags">
        <span class="tag tag-${c.sentiment}">${c.sentiment}</span>
        <span class="tag tag-category">${c.category}</span>
      </div>
    </div>
  `).join('');
}

// ============================================================================
// CAMPAIGNS TABLE
// ============================================================================
async function loadCampaigns() {
  const campaigns = await api('/api/campaigns');
  const tbody = document.querySelector('#campaignsTable tbody');
  if (campaigns.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:40px">Sin campañas. Sincroniza para cargar datos.</td></tr>';
    return;
  }
  tbody.innerHTML = campaigns.map(c => `
    <tr>
      <td>${escapeHtml(c.name)}</td>
      <td><span class="tag ${c.status === 'ACTIVE' ? 'tag-positivo' : 'tag-neutro'}">${c.status}</span></td>
      <td>${fmtMoney(c.spend)}</td>
      <td>${fmt(c.reach)}</td>
      <td>${fmt(c.impressions)}</td>
      <td>${fmt(c.link_clicks)}</td>
      <td>${fmtMoney(c.cpc)}</td>
      <td>${fmtPct(c.ctr)}</td>
    </tr>
  `).join('');
}

// ============================================================================
// ADS COMPARATIVO with recommendations
// ============================================================================
async function loadAds() {
  const ads = await api('/api/ads-grouped?sort=' + currentAdsSort);
  const grid = el('adsGrid');
  if (ads.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="icon">📊</div><p>Sin anuncios. Sincroniza para cargar datos.</p></div>';
    destroyChart('chartAdsComparison');
    return;
  }

  // Compute averages for recommendations
  const avgCpc = ads.reduce((a, b) => a + (b.cpc || 0), 0) / ads.length;
  const avgCtr = ads.reduce((a, b) => a + (b.ctr || 0), 0) / ads.length;

  drawAdsComparison(ads);

  grid.innerHTML = ads.map((ad, i) => {
    const impressions = ad.impressions || 1;
    const v3sPct = ad.impressions > 0 ? Math.round(ad.video_3s_views / impressions * 100) : 0;
    const vThruPct = ad.impressions > 0 ? Math.round(ad.video_thruplay / impressions * 100) : 0;
    const vCompPct = ad.impressions > 0 ? Math.round(ad.video_completions / impressions * 100) : 0;
    const recommendation = computeAdRecommendation(ad, avgCpc, avgCtr);
    const frequency = parseFloat(ad.frequency || 0);
    const freqWarning = frequency >= 3 ? `<span class="ad-warning">⚠ Frec. ${frequency.toFixed(1)}</span>` : '';

    return `
    <div class="ad-card">
      <div class="ad-card-header">
        <div class="ad-rank">${i + 1}</div>
        <div class="ad-name">${escapeHtml(ad.name)}</div>
      </div>
      <div class="ad-adset">${ad.ad_count} anuncios combinados</div>
      <div>
        <span class="ad-recommendation ${recommendation.cls}">${recommendation.label}</span>
        ${freqWarning}
      </div>
      <div class="ad-metrics-grid">
        <div class="ad-metric ${currentAdsSort === 'spend' ? 'ad-metric-highlight' : ''}">
          <div class="ad-metric-label">Inversión</div>
          <div class="ad-metric-value">${fmtMoney(ad.spend)}</div>
        </div>
        <div class="ad-metric ${currentAdsSort === 'reach' ? 'ad-metric-highlight' : ''}">
          <div class="ad-metric-label">Alcance</div>
          <div class="ad-metric-value">${fmtCompact(ad.reach)}</div>
        </div>
        <div class="ad-metric ${currentAdsSort === 'link_clicks' ? 'ad-metric-highlight' : ''}">
          <div class="ad-metric-label">Clics</div>
          <div class="ad-metric-value">${fmt(ad.link_clicks)}</div>
        </div>
        <div class="ad-metric ${currentAdsSort === 'cpc' ? 'ad-metric-highlight' : ''}">
          <div class="ad-metric-label">CPC</div>
          <div class="ad-metric-value">${fmtMoney(ad.cpc)}</div>
        </div>
        <div class="ad-metric">
          <div class="ad-metric-label">Impres.</div>
          <div class="ad-metric-value">${fmtCompact(ad.impressions)}</div>
        </div>
        <div class="ad-metric">
          <div class="ad-metric-label">CTR</div>
          <div class="ad-metric-value">${fmtPct(ad.ctr)}</div>
        </div>
      </div>
      ${ad.video_3s_views > 0 || ad.video_thruplay > 0 || ad.video_completions > 0 ? `
      <div class="retention-section">
        <h4>Retención de video</h4>
        <div class="retention-bar">
          <span class="retention-label">3 seg</span>
          <div class="retention-track"><div class="retention-fill" style="width:${v3sPct}%"></div></div>
          <span class="retention-value">${fmt(ad.video_3s_views)}</span>
        </div>
        <div class="retention-bar">
          <span class="retention-label">15 seg</span>
          <div class="retention-track"><div class="retention-fill" style="width:${vThruPct}%;background:${COLORS.cyan}"></div></div>
          <span class="retention-value">${fmt(ad.video_thruplay)}</span>
        </div>
        <div class="retention-bar">
          <span class="retention-label">Completo</span>
          <div class="retention-track"><div class="retention-fill" style="width:${vCompPct}%;background:${COLORS.ink}"></div></div>
          <span class="retention-value">${fmt(ad.video_completions)}</span>
        </div>
      </div>` : ''}
    </div>`;
  }).join('');
}

function computeAdRecommendation(ad, avgCpc, avgCtr) {
  const cpc = parseFloat(ad.cpc || 0);
  const ctr = parseFloat(ad.ctr || 0);
  const freq = parseFloat(ad.frequency || 0);
  // Pause: high frequency + bad CPC
  if (freq >= 4 && cpc > avgCpc * 1.3) return { cls: 'pause', label: 'Pausar / Refrescar' };
  // Scale: better CPC than avg AND CTR decent
  if (cpc > 0 && cpc < avgCpc * 0.8 && ctr > 0.5) return { cls: 'scale', label: '↑ Escalar' };
  if (ctr > avgCtr * 1.3) return { cls: 'scale', label: '↑ Escalar' };
  // Default: optimize
  return { cls: 'optimize', label: 'Optimizar' };
}

function drawAdsComparison(ads) {
  destroyChart('chartAdsComparison');
  const labels = ads.map(a => a.name.length > 30 ? a.name.slice(0, 30) + '…' : a.name);
  const datasets = [];
  if (['link_clicks', 'reach', 'impressions'].includes(currentAdsSort)) {
    datasets.push(
      { label: 'Clics enlace', data: ads.map(a => a.link_clicks), backgroundColor: COLORS.green, borderRadius: 3 },
      { label: 'Alcance', data: ads.map(a => a.reach), backgroundColor: COLORS.cyan, borderRadius: 3 }
    );
  } else if (currentAdsSort === 'cpc') {
    datasets.push({ label: 'CPC ($)', data: ads.map(a => a.cpc), backgroundColor: COLORS.coral, borderRadius: 3 });
  } else {
    datasets.push(
      { label: '3s Views', data: ads.map(a => a.video_3s_views), backgroundColor: COLORS.green, borderRadius: 3 },
      { label: 'Thruplay 15s', data: ads.map(a => a.video_thruplay), backgroundColor: COLORS.cyan, borderRadius: 3 },
      { label: 'Completas', data: ads.map(a => a.video_completions), backgroundColor: COLORS.ink, borderRadius: 3 }
    );
  }
  charts.chartAdsComparison = new Chart(el('chartAdsComparison'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, color: COLORS.ink, padding: 16 } },
        tooltip: { backgroundColor: COLORS.tooltipBg, titleColor: COLORS.tooltipText, bodyColor: COLORS.tooltipText, padding: 10 }
      },
      scales: {
        x: { grid: { color: COLORS.hairline, drawBorder: false }, ticks: { color: COLORS.muted } },
        y: { grid: { display: false }, ticks: { color: COLORS.ink, font: { size: 11 } } }
      }
    }
  });
}

// ============================================================================
// INSIGHTS
// ============================================================================
async function loadInsights() {
  const container = el('insightsContent');
  const data = await api('/api/insights');

  if (data.isGenerating) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">⏳</div>
        <p><strong>Generando análisis con IA…</strong></p>
        <p style="font-size:12px;margin-top:8px">Este proceso toma 20-40 segundos.</p>
      </div>`;
    setTimeout(() => loadInsights(), 5000);
    return;
  }

  if (!data.insights) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">🧠</div>
        <p><strong>Sin análisis aún</strong></p>
        <p style="font-size:12px;margin-top:8px">Click en "Regenerar Análisis" para crear el primero con IA.</p>
      </div>`;
    el('insightsSubtitle').textContent = `${data.newCommentsSinceLast || 0} comentarios sin analizar`;
    return;
  }

  const ins = data.insights;
  const analysis = ins.analysis || {};
  const generatedAt = new Date(ins.generated_at + 'Z').toLocaleString('es-PA', { dateStyle: 'medium', timeStyle: 'short' });
  const tokensCost = ins.tokens_used ? ((ins.tokens_used.input || 0) * 3 / 1000000 + (ins.tokens_used.output || 0) * 15 / 1000000).toFixed(4) : 0;

  el('insightsSubtitle').textContent = `Último análisis: ${generatedAt} · ${ins.total_comments} comentarios analizados · ${data.newCommentsSinceLast} nuevos desde entonces`;

  const themes = analysis.top_themes || [];
  const questions = analysis.frequent_questions || [];
  const ideas = analysis.content_ideas || [];
  const summary = analysis.insights_summary || '';
  const wordCloud = ins.word_cloud || [];

  container.innerHTML = `
    ${summary ? `
      <div class="insights-summary-card">
        <div class="eyebrow">★ Insight principal</div>
        <p>${escapeHtml(summary)}</p>
      </div>
    ` : ''}

    <div class="insights-meta">
      <span>Ventana: <strong>${ins.window_days} días</strong></span>
      <span>Comentarios: <strong>${ins.total_comments}</strong></span>
      <span>Costo IA: <strong>$${tokensCost}</strong></span>
      <span>Nuevos desde último análisis: <strong>${data.newCommentsSinceLast}</strong></span>
    </div>

    ${themes.length > 0 ? `
      <div class="section-header">
        <h3>Top 3 temas detectados</h3>
        <span class="meta">Conversaciones más recurrentes en los comentarios</span>
      </div>
      <div class="themes-grid">
        ${themes.map((t, i) => `
          <div class="theme-card">
            <span class="theme-rank">Tema ${String(i + 1).padStart(2, '0')}</span>
            <div class="theme-title">
              ${escapeHtml(t.title || '')}
              ${t.sentiment ? `<span class="theme-sentiment-badge tag-${t.sentiment === 'mixto' ? 'neutro' : t.sentiment}">${t.sentiment}</span>` : ''}
            </div>
            <div class="theme-description">${escapeHtml(t.description || '')}</div>
            <div class="theme-stats">
              <div class="theme-stat">
                <span class="theme-stat-value">${t.percentage || 0}%</span>
                <span class="theme-stat-label">del total</span>
              </div>
              <div class="theme-stat">
                <span class="theme-stat-value">${t.mentions || 0}</span>
                <span class="theme-stat-label">menciones</span>
              </div>
            </div>
            <div class="theme-keywords">
              ${(t.keywords || []).map(k => `<span class="theme-keyword">${escapeHtml(k)}</span>`).join('')}
            </div>
            ${(t.example_comments && t.example_comments.length > 0) ? `
              <div class="theme-examples">
                <h4>Comentarios representativos</h4>
                ${t.example_comments.slice(0, 3).map(c => `<div class="theme-example-item">"${escapeHtml(c)}"</div>`).join('')}
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    ` : ''}

    <div class="insights-sections">
      ${questions.length > 0 ? `
        <div class="insights-card">
          <h3>Preguntas frecuentes</h3>
          ${questions.map(q => `
            <div class="faq-item">
              <div class="faq-question">
                <span>${escapeHtml(q.question || '')}</span>
                <span class="faq-count">${q.count || 0}×</span>
              </div>
              ${q.suggested_answer ? `<div class="faq-answer">${escapeHtml(q.suggested_answer)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      ` : '<div></div>'}

      <div class="insights-card">
        <h3>Palabras más mencionadas</h3>
        <div class="word-cloud">
          ${wordCloud.slice(0, 30).map(w => {
            const size = Math.max(11, Math.min(22, 11 + w.count));
            return `<span class="word-cloud-item" style="font-size:${size}px">${escapeHtml(w.word)}</span>`;
          }).join('')}
        </div>
      </div>
    </div>

    ${ideas.length > 0 ? `
      <div class="section-header">
        <h3>Ideas de contenido recomendadas</h3>
        <span class="meta">Generadas a partir de los temas detectados</span>
      </div>
      <div class="content-ideas-grid">
        ${ideas.map(idea => `
          <div class="idea-card">
            <span class="idea-format">${escapeHtml(idea.format || 'post')}</span>
            <div class="idea-title">${escapeHtml(idea.title || '')}</div>
            ${idea.hook ? `<div class="idea-hook">"${escapeHtml(idea.hook)}"</div>` : ''}
            <div class="idea-description">${escapeHtml(idea.description || '')}</div>
            ${idea.reasoning ? `<div class="idea-reasoning"><strong>Por qué funciona:</strong> ${escapeHtml(idea.reasoning)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;
}

async function regenerateInsights() {
  const btn = el('btnRegenerateInsights');
  btn.classList.add('syncing');
  btn.innerHTML = '<span class="sync-icon">✦</span> Generando…';
  try {
    await fetch('/api/insights/regenerate', { method: 'POST' });
    const interval = setInterval(async () => {
      const status = await api('/api/insights/status');
      if (!status.isGenerating) {
        clearInterval(interval);
        btn.classList.remove('syncing');
        btn.innerHTML = '<span class="sync-icon">✦</span> Regenerar Análisis';
        loadInsights();
      }
    }, 3000);
    setTimeout(() => {
      clearInterval(interval);
      btn.classList.remove('syncing');
      btn.innerHTML = '<span class="sync-icon">✦</span> Regenerar Análisis';
      loadInsights();
    }, 180000);
  } catch (err) {
    btn.classList.remove('syncing');
    btn.innerHTML = '<span class="sync-icon">✦</span> Regenerar Análisis';
    alert('Error: ' + err.message);
  }
}

// ============================================================================
// BEST AD (signature card)
// ============================================================================
async function loadBestAd() {
  const ads = await api('/api/ads-grouped?sort=link_clicks');
  if (ads.length > 0) {
    const best = ads[0];
    el('kpi-best-ad').textContent = best.name;
    el('kpi-best-ad-detail').textContent = `${fmt(best.link_clicks)} clics · CPC ${fmtMoney(best.cpc)} · ${fmtCompact(best.reach)} alcance`;

    // Signature card
    const avgClicks = ads.length > 1 ? ads.slice(1).reduce((a, b) => a + (b.link_clicks || 0), 0) / (ads.length - 1) : best.link_clicks;
    const ratio = avgClicks > 0 ? (best.link_clicks / avgClicks) : 1;
    el('best-ad-signature').style.display = 'block';
    el('best-ad-headline').textContent = `${best.name} — ${ratio.toFixed(1)}× el promedio de clics.`;
    el('best-ad-narrative').textContent = `El creativo con mejor performance del periodo. Vale la pena escalar inversión y testear variantes con la misma estructura para mantener el momentum.`;
    el('best-ad-clicks').textContent = fmt(best.link_clicks);
    el('best-ad-clicks-vs').textContent = `+${Math.round((ratio - 1) * 100)}% vs media de campañas`;
    el('best-ad-spend').textContent = fmtMoney(best.spend);
    el('best-ad-cpc-detail').textContent = `CPC ${fmtMoney(best.cpc)} · CTR ${fmtPct(best.ctr)}`;
  }
}

// ============================================================================
// KPI FILTER
// ============================================================================
function toggleKpiFilter(card) {
  const type = card.dataset.filterType;
  const value = card.dataset.filterValue;
  if (activeKpiFilter && activeKpiFilter.type === type && activeKpiFilter.value === value) {
    activeKpiFilter = null;
    card.classList.remove('active-filter');
  } else {
    document.querySelectorAll('.kpi-filter').forEach(k => k.classList.remove('active-filter'));
    activeKpiFilter = { type, value };
    card.classList.add('active-filter');
  }
  if (activeKpiFilter) {
    if (activeKpiFilter.type === 'sentiment') {
      el('filterSentiment').value = activeKpiFilter.value;
      el('filterCategory').value = '';
    } else {
      el('filterSentiment').value = '';
      el('filterCategory').value = activeKpiFilter.value;
    }
  } else {
    el('filterSentiment').value = '';
    el('filterCategory').value = '';
  }
  selectedPostId = null;
  loadPosts();
  loadComments();
}

// ============================================================================
// SYNC
// ============================================================================
async function triggerSync() {
  const btn = el('btnSync');
  btn.classList.add('syncing');
  btn.innerHTML = '<span class="sync-icon">↻</span> Sincronizando…';
  try {
    await fetch('/api/sync', { method: 'POST' });
    pollSyncStatus();
  } catch (err) {
    btn.classList.remove('syncing');
    btn.innerHTML = '<span class="sync-icon">↻</span> Sincronizar';
  }
}

function pollSyncStatus() {
  const btn = el('btnSync');
  const interval = setInterval(async () => {
    try {
      const status = await api('/api/sync-status');
      if (!status.isSyncing) {
        clearInterval(interval);
        btn.classList.remove('syncing');
        btn.innerHTML = '<span class="sync-icon">↻</span> Sincronizar';
        loadDashboard();
      }
    } catch (e) { /* keep polling */ }
  }, 3000);
  setTimeout(() => {
    clearInterval(interval);
    btn.classList.remove('syncing');
    btn.innerHTML = '<span class="sync-icon">↻</span> Sincronizar';
    loadDashboard();
  }, 120000);
}

// ============================================================================
// UTILITIES
// ============================================================================
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// Auto refresh every 60s
setInterval(() => { loadDashboard(); }, 60000);

// Init: load client branding first, then dashboard data
loadClientConfig().then(() => loadDashboard());
