const Database = require('better-sqlite3');
const path = require('path');

const fs = require('fs');
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const DB_NAME = process.env.DB_NAME || `${(process.env.CLIENT_SLUG || 'monitor').toLowerCase()}.db`;
const DB_PATH = path.join(dataDir, DB_NAME);

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      post_id TEXT UNIQUE NOT NULL,
      caption TEXT,
      media_url TEXT,
      permalink TEXT,
      like_count INTEGER DEFAULT 0,
      comments_count INTEGER DEFAULT 0,
      created_at TEXT,
      synced_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id TEXT NOT NULL,
      comment_id TEXT UNIQUE NOT NULL,
      author TEXT,
      text TEXT,
      sentiment TEXT,
      category TEXT,
      like_count INTEGER DEFAULT 0,
      created_at TEXT,
      synced_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (post_id) REFERENCES posts(post_id)
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT UNIQUE NOT NULL,
      name TEXT,
      status TEXT,
      objective TEXT,
      spend REAL DEFAULT 0,
      reach INTEGER DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      link_clicks INTEGER DEFAULT 0,
      cpc REAL DEFAULT 0,
      ctr REAL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ad_id TEXT UNIQUE NOT NULL,
      campaign_id TEXT NOT NULL,
      adset_name TEXT,
      name TEXT,
      status TEXT,
      spend REAL DEFAULT 0,
      reach INTEGER DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      link_clicks INTEGER DEFAULT 0,
      cpc REAL DEFAULT 0,
      ctr REAL DEFAULT 0,
      frequency REAL DEFAULT 0,
      video_3s_views INTEGER DEFAULT 0,
      video_thruplay INTEGER DEFAULT 0,
      video_completions INTEGER DEFAULT 0,
      thumbnail_url TEXT,
      preview_url TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id)
    );

    CREATE TABLE IF NOT EXISTS daily_insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      date TEXT NOT NULL,
      spend REAL DEFAULT 0,
      reach INTEGER DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      link_clicks INTEGER DEFAULT 0,
      cpc REAL DEFAULT 0,
      video_3s_views INTEGER DEFAULT 0,
      video_completions INTEGER DEFAULT 0,
      UNIQUE(entity_type, entity_id, date)
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_type TEXT NOT NULL,
      started_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      records_synced INTEGER DEFAULT 0,
      status TEXT DEFAULT 'running',
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS content_insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generated_at TEXT DEFAULT (datetime('now')),
      window_days INTEGER DEFAULT 30,
      total_comments INTEGER DEFAULT 0,
      analysis_json TEXT,
      word_cloud_json TEXT,
      tokens_used_json TEXT,
      status TEXT DEFAULT 'completed'
    );

    CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
    CREATE INDEX IF NOT EXISTS idx_comments_sentiment ON comments(sentiment);
    CREATE INDEX IF NOT EXISTS idx_comments_category ON comments(category);
    CREATE INDEX IF NOT EXISTS idx_ads_campaign ON ads(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_daily_entity ON daily_insights(entity_type, entity_id);
  `);
}

// Posts
const upsertPost = (post) => {
  const stmt = getDb().prepare(`
    INSERT INTO posts (platform, post_id, caption, media_url, permalink, like_count, comments_count, created_at, synced_at)
    VALUES (@platform, @post_id, @caption, @media_url, @permalink, @like_count, @comments_count, @created_at, datetime('now'))
    ON CONFLICT(post_id) DO UPDATE SET
      caption=@caption, media_url=@media_url, permalink=@permalink,
      like_count=@like_count, comments_count=@comments_count, synced_at=datetime('now')
  `);
  return stmt.run(post);
};

// Comments
const upsertComment = (comment) => {
  const stmt = getDb().prepare(`
    INSERT INTO comments (post_id, comment_id, author, text, sentiment, category, like_count, created_at, synced_at)
    VALUES (@post_id, @comment_id, @author, @text, @sentiment, @category, @like_count, @created_at, datetime('now'))
    ON CONFLICT(comment_id) DO UPDATE SET
      text=@text, sentiment=@sentiment, category=@category, like_count=@like_count, synced_at=datetime('now')
  `);
  return stmt.run(comment);
};

// Campaigns
const upsertCampaign = (campaign) => {
  const stmt = getDb().prepare(`
    INSERT INTO campaigns (campaign_id, name, status, objective, spend, reach, impressions, link_clicks, cpc, ctr, updated_at)
    VALUES (@campaign_id, @name, @status, @objective, @spend, @reach, @impressions, @link_clicks, @cpc, @ctr, datetime('now'))
    ON CONFLICT(campaign_id) DO UPDATE SET
      name=@name, status=@status, objective=@objective, spend=@spend, reach=@reach,
      impressions=@impressions, link_clicks=@link_clicks, cpc=@cpc, ctr=@ctr, updated_at=datetime('now')
  `);
  return stmt.run(campaign);
};

// Ads
const upsertAd = (ad) => {
  const stmt = getDb().prepare(`
    INSERT INTO ads (ad_id, campaign_id, adset_name, name, status, spend, reach, impressions, link_clicks, cpc, ctr, frequency, video_3s_views, video_thruplay, video_completions, thumbnail_url, preview_url, updated_at)
    VALUES (@ad_id, @campaign_id, @adset_name, @name, @status, @spend, @reach, @impressions, @link_clicks, @cpc, @ctr, @frequency, @video_3s_views, @video_thruplay, @video_completions, @thumbnail_url, @preview_url, datetime('now'))
    ON CONFLICT(ad_id) DO UPDATE SET
      name=@name, status=@status, spend=@spend, reach=@reach, impressions=@impressions,
      link_clicks=@link_clicks, cpc=@cpc, ctr=@ctr, frequency=@frequency,
      video_3s_views=@video_3s_views, video_thruplay=@video_thruplay, video_completions=@video_completions,
      thumbnail_url=@thumbnail_url, preview_url=@preview_url, updated_at=datetime('now')
  `);
  return stmt.run(ad);
};

// Daily Insights
const upsertDailyInsight = (insight) => {
  const stmt = getDb().prepare(`
    INSERT INTO daily_insights (entity_type, entity_id, date, spend, reach, impressions, link_clicks, cpc, video_3s_views, video_completions)
    VALUES (@entity_type, @entity_id, @date, @spend, @reach, @impressions, @link_clicks, @cpc, @video_3s_views, @video_completions)
    ON CONFLICT(entity_type, entity_id, date) DO UPDATE SET
      spend=@spend, reach=@reach, impressions=@impressions, link_clicks=@link_clicks,
      cpc=@cpc, video_3s_views=@video_3s_views, video_completions=@video_completions
  `);
  return stmt.run(insight);
};

// Sync Log
const startSync = (type) => {
  const stmt = getDb().prepare(`INSERT INTO sync_log (sync_type) VALUES (?)`);
  return stmt.run(type);
};

const completeSync = (id, count, error = null) => {
  const stmt = getDb().prepare(`
    UPDATE sync_log SET completed_at=datetime('now'), records_synced=?, status=?, error=? WHERE id=?
  `);
  return stmt.run(count, error ? 'error' : 'completed', error, id);
};

// Queries for Dashboard
const getDashboardOverview = () => {
  const d = getDb();
  const totalComments = d.prepare('SELECT COUNT(*) as count FROM comments').get();
  const sentimentDist = d.prepare(`
    SELECT sentiment, COUNT(*) as count FROM comments WHERE sentiment IS NOT NULL GROUP BY sentiment
  `).all();
  const categoryDist = d.prepare(`
    SELECT category, COUNT(*) as count FROM comments WHERE category IS NOT NULL GROUP BY category
  `).all();
  const adsTotals = d.prepare(`
    SELECT COALESCE(SUM(spend),0) as total_spend, COALESCE(SUM(reach),0) as total_reach,
           COALESCE(SUM(impressions),0) as total_impressions, COALESCE(SUM(link_clicks),0) as total_link_clicks
    FROM ads
  `).get();
  const avgCpc = d.prepare(`
    SELECT CASE WHEN SUM(link_clicks) > 0 THEN SUM(spend)/SUM(link_clicks) ELSE 0 END as avg_cpc FROM ads
  `).get();
  const lastSync = d.prepare(`SELECT * FROM sync_log ORDER BY id DESC LIMIT 1`).get();

  return { totalComments: totalComments.count, sentimentDist, categoryDist, adsTotals, avgCpc: avgCpc.avg_cpc, lastSync };
};

const getPosts = () => {
  return getDb().prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.post_id) as comment_count,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.post_id AND c.sentiment = 'positivo') as positive,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.post_id AND c.sentiment = 'negativo') as negative,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.post_id AND c.sentiment = 'neutro') as neutral
    FROM posts p
    WHERE p.caption IS NOT NULL AND p.caption != ''
      AND (SELECT COUNT(*) FROM comments c2 WHERE c2.post_id = p.post_id) > 0
    ORDER BY comment_count DESC
  `).all();
};

const getComments = (postId, sentiment, category) => {
  let sql = 'SELECT * FROM comments WHERE 1=1';
  const params = {};
  if (postId) { sql += ' AND post_id = @postId'; params.postId = postId; }
  if (sentiment) { sql += ' AND sentiment = @sentiment'; params.sentiment = sentiment; }
  if (category) { sql += ' AND category = @category'; params.category = category; }
  sql += ' ORDER BY created_at DESC LIMIT 500';
  return getDb().prepare(sql).all(params);
};

const getCampaigns = () => {
  return getDb().prepare('SELECT * FROM campaigns ORDER BY spend DESC').all();
};

const getAds = (sortBy = 'link_clicks') => {
  const validSorts = ['link_clicks', 'reach', 'cpc', 'spend', 'video_3s_views', 'video_thruplay', 'video_completions', 'ctr', 'impressions'];
  const sort = validSorts.includes(sortBy) ? sortBy : 'link_clicks';
  const dir = sort === 'cpc' ? 'ASC' : 'DESC';
  return getDb().prepare(`SELECT * FROM ads ORDER BY ${sort} ${dir}`).all();
};

// Ads grouped by creative name (same name = same creative)
const getAdsGrouped = (sortBy = 'link_clicks') => {
  const validSorts = ['link_clicks', 'reach', 'cpc', 'spend', 'video_3s_views', 'video_thruplay', 'video_completions', 'ctr', 'impressions'];
  const sort = validSorts.includes(sortBy) ? sortBy : 'link_clicks';
  const dir = sort === 'cpc' ? 'ASC' : 'DESC';
  return getDb().prepare(`
    SELECT
      name,
      COUNT(*) as ad_count,
      SUM(spend) as spend,
      SUM(reach) as reach,
      SUM(impressions) as impressions,
      SUM(link_clicks) as link_clicks,
      CASE WHEN SUM(link_clicks) > 0 THEN SUM(spend) / SUM(link_clicks) ELSE 0 END as cpc,
      CASE WHEN SUM(impressions) > 0 THEN CAST(SUM(link_clicks) AS REAL) / SUM(impressions) * 100 ELSE 0 END as ctr,
      AVG(frequency) as frequency,
      SUM(video_3s_views) as video_3s_views,
      SUM(video_thruplay) as video_thruplay,
      SUM(video_completions) as video_completions,
      GROUP_CONCAT(DISTINCT campaign_id) as campaign_ids,
      GROUP_CONCAT(DISTINCT adset_name) as adset_names
    FROM ads
    GROUP BY name
    ORDER BY ${sort} ${dir}
  `).all();
};

const getDailyInsights = (entityType = 'campaign') => {
  return getDb().prepare(`
    SELECT date, SUM(spend) as spend, SUM(reach) as reach, SUM(impressions) as impressions,
           SUM(link_clicks) as link_clicks,
           CASE WHEN SUM(link_clicks)>0 THEN SUM(spend)/SUM(link_clicks) ELSE 0 END as cpc
    FROM daily_insights WHERE entity_type = ?
    GROUP BY date ORDER BY date
  `).all(entityType);
};

const getSentimentTimeline = () => {
  return getDb().prepare(`
    SELECT substr(created_at, 1, 10) as date, sentiment, COUNT(*) as count
    FROM comments WHERE sentiment IS NOT NULL AND created_at IS NOT NULL
    GROUP BY substr(created_at, 1, 10), sentiment ORDER BY date
  `).all();
};

const getLastSyncTime = () => {
  const row = getDb().prepare(`SELECT completed_at FROM sync_log WHERE status='completed' ORDER BY id DESC LIMIT 1`).get();
  return row ? row.completed_at : null;
};

// Content Insights
const saveInsights = (data) => {
  return getDb().prepare(`
    INSERT INTO content_insights (window_days, total_comments, analysis_json, word_cloud_json, tokens_used_json, status)
    VALUES (@window_days, @total_comments, @analysis_json, @word_cloud_json, @tokens_used_json, @status)
  `).run({
    window_days: data.window_days || 30,
    total_comments: data.total_comments || 0,
    analysis_json: JSON.stringify(data.analysis || {}),
    word_cloud_json: JSON.stringify(data.word_cloud || []),
    tokens_used_json: JSON.stringify(data.tokens_used || {}),
    status: data.status || 'completed'
  });
};

const getLatestInsights = () => {
  const row = getDb().prepare(`
    SELECT * FROM content_insights WHERE status = 'completed' ORDER BY id DESC LIMIT 1
  `).get();
  if (!row) return null;
  return {
    id: row.id,
    generated_at: row.generated_at,
    window_days: row.window_days,
    total_comments: row.total_comments,
    analysis: JSON.parse(row.analysis_json || '{}'),
    word_cloud: JSON.parse(row.word_cloud_json || '[]'),
    tokens_used: JSON.parse(row.tokens_used_json || '{}')
  };
};

const getCommentsCountSinceLastInsight = () => {
  const last = getDb().prepare(`SELECT generated_at FROM content_insights ORDER BY id DESC LIMIT 1`).get();
  if (!last) {
    return getDb().prepare(`SELECT COUNT(*) as count FROM comments`).get().count;
  }
  return getDb().prepare(`SELECT COUNT(*) as count FROM comments WHERE synced_at > ?`).get(last.generated_at).count;
};

module.exports = {
  getDb, upsertPost, upsertComment, upsertCampaign, upsertAd, upsertDailyInsight,
  startSync, completeSync, getDashboardOverview, getPosts, getComments, getAdsGrouped,
  saveInsights, getLatestInsights, getCommentsCountSinceLastInsight,
  getCampaigns, getAds, getDailyInsights, getSentimentTimeline, getLastSyncTime
};
