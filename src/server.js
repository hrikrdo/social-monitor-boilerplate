require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const db = require('./db/database');
const metaClient = require('./api/meta-client');
const adsClient = require('./api/ads-client');
const sentiment = require('./analysis/sentiment');
const contentInsights = require('./analysis/content-insights');

const app = express();
const PORT = process.env.PORT || 3000;
const CLIENT_NAME = process.env.CLIENT_NAME || 'Social Monitor';
const CLIENT_TAGLINE = process.env.CLIENT_TAGLINE || 'Social Media & Ads Monitor';
const CLIENT_LOCATION = process.env.CLIENT_LOCATION || '';
const BRAND_COLOR = process.env.BRAND_COLOR || '#00d750';
const BRAND_COLOR_DEEP = process.env.BRAND_COLOR_DEEP || '#0a3d18';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// --- Client config endpoint (public-safe, no secrets) ---
app.get('/api/config', (req, res) => {
  res.json({
    clientName: CLIENT_NAME,
    clientTagline: CLIENT_TAGLINE,
    clientLocation: CLIENT_LOCATION,
    brandColor: BRAND_COLOR,
    brandColorDeep: BRAND_COLOR_DEEP
  });
});

// --- Health check ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', client: CLIENT_NAME, port: PORT });
});

// --- Sync Function ---
let isSyncing = false;

async function runSync() {
  if (isSyncing) {
    console.log('[Sync] Already running, skipping...');
    return { status: 'skipped', message: 'Sync already in progress' };
  }

  isSyncing = true;
  const syncRecord = db.startSync('full');
  const syncId = syncRecord.lastInsertRowid;
  let totalRecords = 0;

  console.log(`[Sync] Starting full sync at ${new Date().toISOString()}`);

  try {
    // Sync comments
    const commentCount = await metaClient.syncAllComments(db, sentiment.analyze);
    totalRecords += commentCount;
    console.log(`[Sync] Comments synced: ${commentCount}`);

    // Sync ads
    const adsCount = await adsClient.syncAllAds(db);
    totalRecords += adsCount;
    console.log(`[Sync] Ads synced: ${adsCount}`);

    db.completeSync(syncId, totalRecords);
    console.log(`[Sync] Completed. Total records: ${totalRecords}`);
    return { status: 'completed', totalRecords };
  } catch (err) {
    console.error('[Sync] Error:', err.message);
    db.completeSync(syncId, totalRecords, err.message);
    return { status: 'error', message: err.message, totalRecords };
  } finally {
    isSyncing = false;
  }
}

// --- API Endpoints ---

// Dashboard overview
app.get('/api/dashboard', (req, res) => {
  try {
    const { from, to } = req.query;
    const overview = db.getDashboardOverview(from, to);
    const lastSync = db.getLastSyncTime();
    res.json({ ...overview, lastSync, isSyncing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Posts
app.get('/api/posts', (req, res) => {
  try {
    res.json(db.getPosts());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Comments
app.get('/api/comments', (req, res) => {
  try {
    const { post_id, sentiment, category, from, to } = req.query;
    res.json(db.getComments(post_id, sentiment, category, from, to));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Campaigns
app.get('/api/campaigns', (req, res) => {
  try {
    const { from, to } = req.query;
    res.json(db.getCampaigns(from, to));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ads (individual)
app.get('/api/ads', (req, res) => {
  try {
    const { sort } = req.query;
    res.json(db.getAds(sort));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ads grouped by creative name
app.get('/api/ads-grouped', (req, res) => {
  try {
    const { sort, from, to } = req.query;
    res.json(db.getAdsGrouped(sort, from, to));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Daily insights
app.get('/api/daily-insights', (req, res) => {
  try {
    const { type, from, to } = req.query;
    res.json(db.getDailyInsights(type || 'campaign', from, to));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sentiment timeline
app.get('/api/sentiment-timeline', (req, res) => {
  try {
    const { from, to } = req.query;
    res.json(db.getSentimentTimeline(from, to));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger sync manually (non-blocking - responds immediately)
app.post('/api/sync', (req, res) => {
  if (isSyncing) {
    return res.json({ status: 'already_running', message: 'Sync already in progress' });
  }
  // Start sync in background, respond immediately
  res.json({ status: 'started', message: 'Sync started in background' });
  runSync().catch(err => console.error('[Sync] Background error:', err.message));
});

// Sync status
app.get('/api/sync-status', (req, res) => {
  res.json({ isSyncing, lastSync: db.getLastSyncTime() });
});

// --- Content Insights ---
let isGeneratingInsights = false;

async function runInsightsGeneration(force = false) {
  if (isGeneratingInsights) {
    return { status: 'already_running' };
  }

  // Check if we have enough new comments (unless forced)
  if (!force) {
    const newComments = db.getCommentsCountSinceLastInsight();
    const hasExisting = db.getLatestInsights() !== null;
    if (hasExisting && newComments < 20) {
      console.log(`[Insights] Skipping. Only ${newComments} new comments (need 20+)`);
      return { status: 'skipped', reason: `Solo ${newComments} comentarios nuevos (minimo 20)` };
    }
  }

  isGeneratingInsights = true;
  console.log('[Insights] Generating content insights with Claude...');

  try {
    const result = await contentInsights.generateInsights(db, 30);

    if (result.status === 'completed') {
      db.saveInsights({
        window_days: result.window_days,
        total_comments: result.total_comments,
        analysis: result.analysis,
        word_cloud: result.word_cloud,
        tokens_used: result.tokens_used,
        status: 'completed'
      });
      console.log(`[Insights] Completed. Analyzed ${result.total_comments} comments. Tokens: ${JSON.stringify(result.tokens_used)}`);
    }

    return result;
  } catch (err) {
    console.error('[Insights] Error:', err.message);
    return { status: 'error', message: err.message };
  } finally {
    isGeneratingInsights = false;
  }
}

// Get latest insights
app.get('/api/insights', (req, res) => {
  try {
    const insights = db.getLatestInsights();
    const newComments = db.getCommentsCountSinceLastInsight();
    res.json({
      insights,
      isGenerating: isGeneratingInsights,
      newCommentsSinceLast: newComments
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger insights generation manually (non-blocking)
app.post('/api/insights/regenerate', (req, res) => {
  if (isGeneratingInsights) {
    return res.json({ status: 'already_running', message: 'Analisis ya en proceso' });
  }
  res.json({ status: 'started', message: 'Generacion de insights iniciada' });
  runInsightsGeneration(true).catch(err => console.error('[Insights] Background error:', err.message));
});

// Insights status
app.get('/api/insights/status', (req, res) => {
  res.json({ isGenerating: isGeneratingInsights });
});

// --- Cron: every hour (sync comments/ads) ---
cron.schedule('0 * * * *', () => {
  console.log('[Cron] Triggered hourly sync');
  runSync();
});

// --- Cron: 6 AM Panama (UTC-5) = 11 UTC - insights generation ---
cron.schedule('0 11 * * *', () => {
  console.log('[Cron] Triggered daily insights generation (6 AM Panama)');
  runInsightsGeneration(false);
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`\n  ${CLIENT_NAME} Monitor running at http://localhost:${PORT}\n`);
  console.log(`  Client: ${CLIENT_NAME}${CLIENT_LOCATION ? ' (' + CLIENT_LOCATION + ')' : ''}`);
  console.log(`  Campaign filter: ${process.env.CAMPAIGN_FILTER || '(none — all campaigns)'}`);
  // Initialize database on startup
  db.getDb();
  console.log('  Database initialized');
  console.log('  Cron scheduled: every hour');
  console.log('  POST /api/sync to trigger manual sync\n');
});
