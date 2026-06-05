exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  let email;
  try {
    const body = JSON.parse(event.body);
    email = (body.email || '').trim().toLowerCase();
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email is required' }) };
  }

  const KLAVIYO_TOKEN = process.env.KLAVIYO_TOKEN;
  if (!KLAVIYO_TOKEN) {
    console.error('Missing KLAVIYO_TOKEN environment variable');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  try {
    const url = `https://a.klaviyo.com/api/profiles/?filter=equals(email,"${encodeURIComponent(email)}")&fields[profile]=email,properties`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_TOKEN}`,
        'revision': '2024-02-15',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Klaviyo API error:', response.status, text);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not reach Klaviyo' }) };
    }

    const data = await response.json();
    const profiles = data.data || [];

    if (profiles.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ allowed: false }) };
    }

    const REQUIRED_TAG = 'appstle_subscription_active_customer';

    let allowed = false;
    let birthday = null;
    let birthdayChangeCount = 0;
    let birthdayLocked = false;

    profiles.forEach(function (profile) {
      const props = (profile.attributes && profile.attributes.properties) || {};

      // ── Subscriber check ──
      const shopifyTags = props['Shopify Tags'] || props['shopify_tags'] || [];
      const tagsArray = Array.isArray(shopifyTags) ? shopifyTags : [shopifyTags];
      if (tagsArray.some(tag => tag.toLowerCase() === REQUIRED_TAG.toLowerCase())) {
        allowed = true;
      }

      // ── Birthday fields ──
      if (props['birthday']) birthday = props['birthday'];
      if (props['birthday_change_count'] !== undefined) birthdayChangeCount = Number(props['birthday_change_count']);
      if (props['birthday_locked']) birthdayLocked = Boolean(props['birthday_locked']);
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        allowed,
        birthday,           // e.g. "06-15" (MM-DD) or null
        birthdayChangeCount, // 0 or 1
        birthdayLocked,      // true once they've used their one correction
      }),
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
