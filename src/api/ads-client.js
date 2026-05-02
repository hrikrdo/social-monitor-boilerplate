const API_BASE = 'https://graph.facebook.com/v21.0';

function tokenParam() {
  return `access_token=${process.env.META_ACCESS_TOKEN}`;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Meta Ads API error ${res.status}: ${err}`);
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

// Get campaigns filtered by name containing CAMPAIGN_FILTER (case-insensitive)
// If CAMPAIGN_FILTER is empty or not set, returns ALL campaigns from the ad account.
async function getCampaigns() {
  const adAccountId = process.env.AD_ACCOUNT_ID;
  const filter = (process.env.CAMPAIGN_FILTER || '').trim().toLowerCase();
  const url = `${API_BASE}/act_${adAccountId}/campaigns?fields=id,name,status,objective,start_time,stop_time&limit=100&${tokenParam()}`;
  const all = await fetchAllPages(url);
  if (!filter) return all;
  return all.filter(c => c.name.toLowerCase().includes(filter));
}

// Get campaign-level insights
async function getCampaignInsights(campaignId) {
  const fields = 'spend,reach,impressions,clicks,cpc,ctr,actions,cost_per_action_type';
  const url = `${API_BASE}/${campaignId}/insights?fields=${fields}&date_preset=maximum&${tokenParam()}`;
  const data = await fetchJson(url);
  return data.data?.[0] || null;
}

// Get daily insights for a campaign
async function getCampaignDailyInsights(campaignId) {
  const fields = 'spend,reach,impressions,clicks,actions,cost_per_action_type';
  const url = `${API_BASE}/${campaignId}/insights?fields=${fields}&time_increment=1&date_preset=maximum&limit=500&${tokenParam()}`;
  return fetchAllPages(url);
}

// Get all ads for a campaign
async function getAdsForCampaign(campaignId) {
  const url = `${API_BASE}/${campaignId}/ads?fields=id,name,status,adset_name,creative{thumbnail_url,effective_object_story_id}&limit=100&${tokenParam()}`;
  return fetchAllPages(url);
}

// Get ad-level insights with video metrics
async function getAdInsights(adId) {
  const fields = [
    'spend', 'reach', 'impressions', 'clicks', 'cpc', 'ctr', 'frequency',
    'actions', 'cost_per_action_type',
    'video_p25_watched_actions', 'video_p50_watched_actions',
    'video_p75_watched_actions', 'video_p100_watched_actions',
    'video_thruplay_watched_actions'
  ].join(',');
  const url = `${API_BASE}/${adId}/insights?fields=${fields}&date_preset=maximum&${tokenParam()}`;
  const data = await fetchJson(url);
  return data.data?.[0] || null;
}

// Extract link_clicks from actions array
function extractLinkClicks(actions) {
  if (!actions) return 0;
  const lc = actions.find(a => a.action_type === 'link_click');
  return lc ? parseInt(lc.value, 10) : 0;
}

// Extract cost per link click
function extractCostPerLinkClick(costPerAction) {
  if (!costPerAction) return 0;
  const cplc = costPerAction.find(a => a.action_type === 'link_click');
  return cplc ? parseFloat(cplc.value) : 0;
}

// Extract video view count from video actions
function extractVideoViews(videoActions) {
  if (!videoActions) return 0;
  return videoActions.reduce((sum, a) => sum + parseInt(a.value || 0, 10), 0);
}

// --- Sync All Ads Data ---
async function syncAllAds(db) {
  let totalSynced = 0;

  try {
    const campaigns = await getCampaigns();
    const filterLabel = process.env.CAMPAIGN_FILTER ? `"${process.env.CAMPAIGN_FILTER}"` : 'all';
    console.log(`[Ads] Found ${campaigns.length} campaigns (filter: ${filterLabel})`);

    for (const campaign of campaigns) {
      // Campaign insights
      const cInsights = await getCampaignInsights(campaign.id);
      const cLinkClicks = cInsights ? extractLinkClicks(cInsights.actions) : 0;
      const cCpcLink = cInsights ? extractCostPerLinkClick(cInsights.cost_per_action_type) : 0;

      db.upsertCampaign({
        campaign_id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        objective: campaign.objective || '',
        spend: parseFloat(cInsights?.spend || 0),
        reach: parseInt(cInsights?.reach || 0, 10),
        impressions: parseInt(cInsights?.impressions || 0, 10),
        link_clicks: cLinkClicks,
        cpc: cCpcLink,
        ctr: parseFloat(cInsights?.ctr || 0)
      });

      // Daily insights for campaign
      try {
        const dailyData = await getCampaignDailyInsights(campaign.id);
        for (const day of dailyData) {
          const dayLinkClicks = extractLinkClicks(day.actions);
          const dayCpc = extractCostPerLinkClick(day.cost_per_action_type);
          db.upsertDailyInsight({
            entity_type: 'campaign',
            entity_id: campaign.id,
            date: day.date_start,
            spend: parseFloat(day.spend || 0),
            reach: parseInt(day.reach || 0, 10),
            impressions: parseInt(day.impressions || 0, 10),
            link_clicks: dayLinkClicks,
            cpc: dayCpc,
            video_3s_views: 0,
            video_completions: 0
          });
        }
      } catch (err) {
        console.error(`[Ads] Error fetching daily insights for campaign ${campaign.name}:`, err.message);
      }

      // Ads for this campaign
      const ads = await getAdsForCampaign(campaign.id);
      for (const ad of ads) {
        try {
          const insights = await getAdInsights(ad.id);
          if (!insights) continue;

          const linkClicks = extractLinkClicks(insights.actions);
          const cpcLink = extractCostPerLinkClick(insights.cost_per_action_type);
          const v3s = extractVideoViews(insights.video_p25_watched_actions);
          const vThruplay = extractVideoViews(insights.video_thruplay_watched_actions);
          const vComplete = extractVideoViews(insights.video_p100_watched_actions);

          db.upsertAd({
            ad_id: ad.id,
            campaign_id: campaign.id,
            adset_name: ad.adset_name || '',
            name: ad.name,
            status: ad.status,
            spend: parseFloat(insights.spend || 0),
            reach: parseInt(insights.reach || 0, 10),
            impressions: parseInt(insights.impressions || 0, 10),
            link_clicks: linkClicks,
            cpc: cpcLink,
            ctr: parseFloat(insights.ctr || 0),
            frequency: parseFloat(insights.frequency || 0),
            video_3s_views: v3s,
            video_thruplay: vThruplay,
            video_completions: vComplete,
            thumbnail_url: ad.creative?.thumbnail_url || '',
            preview_url: ''
          });
          totalSynced++;
        } catch (err) {
          console.error(`[Ads] Error fetching insights for ad ${ad.name}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('[Ads] Error syncing campaigns:', err.message);
  }

  return totalSynced;
}

module.exports = { syncAllAds, getCampaigns };
