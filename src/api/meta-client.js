const API_BASE = 'https://graph.facebook.com/v21.0';

function tokenParam(token) {
  return `access_token=${token || process.env.META_ACCESS_TOKEN}`;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Meta API error ${res.status}: ${err}`);
  }
  return res.json();
}

async function fetchAllPages(url) {
  const results = [];
  let nextUrl = url;
  while (nextUrl) {
    const data = await fetchJson(nextUrl);
    if (data.data) results.push(...data.data);
    nextUrl = data.paging?.next || null;
  }
  return results;
}

// --- Get Page Token ---
let cachedPageToken = null;

async function getPageToken() {
  if (cachedPageToken) return cachedPageToken;
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const url = `${API_BASE}/me/accounts?${tokenParam()}`;
  const data = await fetchJson(url);
  const page = data.data?.find(p => p.id === pageId);
  if (!page) throw new Error(`Page ${pageId} not found in accounts`);
  cachedPageToken = page.access_token;
  return cachedPageToken;
}

// --- Instagram ---

async function getInstagramMedia() {
  const igId = process.env.INSTAGRAM_ACCOUNT_ID;
  const pageToken = await getPageToken();
  const url = `${API_BASE}/${igId}/media?fields=id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count&limit=50&${tokenParam(pageToken)}`;
  return fetchAllPages(url);
}

async function getInstagramComments(mediaId) {
  const pageToken = await getPageToken();
  const url = `${API_BASE}/${mediaId}/comments?fields=id,text,username,timestamp,like_count&limit=100&${tokenParam(pageToken)}`;
  return fetchAllPages(url);
}

// --- Facebook Page ---

async function getFacebookPosts() {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const pageToken = await getPageToken();
  const url = `${API_BASE}/${pageId}/published_posts?fields=id,message,created_time,full_picture,permalink_url,shares&limit=50&${tokenParam(pageToken)}`;
  return fetchAllPages(url);
}

async function getFacebookComments(postId) {
  const pageToken = await getPageToken();
  const url = `${API_BASE}/${postId}/comments?fields=id,message,from,created_time,like_count&limit=100&${tokenParam(pageToken)}`;
  return fetchAllPages(url);
}

// --- Sync All Comments ---

async function syncAllComments(db, analyzeFn) {
  let totalSynced = 0;

  // Instagram
  try {
    const media = await getInstagramMedia();
    for (const m of media) {
      db.upsertPost({
        platform: 'instagram',
        post_id: m.id,
        caption: m.caption || '',
        media_url: m.media_url || m.thumbnail_url || '',
        permalink: m.permalink || '',
        like_count: m.like_count || 0,
        comments_count: m.comments_count || 0,
        created_at: m.timestamp || new Date().toISOString()
      });

      if (m.comments_count > 0) {
        const comments = await getInstagramComments(m.id);
        for (const c of comments) {
          const analysis = analyzeFn(c.text || '');
          db.upsertComment({
            post_id: m.id,
            comment_id: c.id,
            author: c.username || 'unknown',
            text: c.text || '',
            sentiment: analysis.sentiment,
            category: analysis.category,
            like_count: c.like_count || 0,
            created_at: c.timestamp || new Date().toISOString()
          });
          totalSynced++;
        }
      }
    }
    console.log(`[Instagram] Synced ${media.length} posts`);
  } catch (err) {
    console.error('[Instagram] Error syncing:', err.message);
  }

  // Facebook
  try {
    const posts = await getFacebookPosts();
    for (const p of posts) {
      db.upsertPost({
        platform: 'facebook',
        post_id: p.id,
        caption: p.message || '',
        media_url: p.full_picture || '',
        permalink: p.permalink_url || '',
        like_count: 0,
        comments_count: 0,
        created_at: p.created_time || new Date().toISOString()
      });

      // Try to get comments for each post
      try {
        const comments = await getFacebookComments(p.id);
        for (const c of comments) {
          const analysis = analyzeFn(c.message || '');
          db.upsertComment({
            post_id: p.id,
            comment_id: c.id,
            author: c.from?.name || 'unknown',
            text: c.message || '',
            sentiment: analysis.sentiment,
            category: analysis.category,
            like_count: c.like_count || 0,
            created_at: c.created_time || new Date().toISOString()
          });
          totalSynced++;
        }
      } catch (err) {
        // Some posts may not allow comment reading
        console.log(`[Facebook] Could not read comments for post ${p.id}:`, err.message?.slice(0, 80));
      }
    }
    console.log(`[Facebook] Synced ${posts.length} posts`);
  } catch (err) {
    console.error('[Facebook] Error syncing:', err.message);
  }

  return totalSynced;
}

module.exports = { syncAllComments, getInstagramMedia, getFacebookPosts };
