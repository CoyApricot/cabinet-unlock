exports.handler = async function (event) {
  /* ── CORS headers ── */
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
    /* ── Look up the profile by email in Klaviyo ── */
    const url = `https://a.klaviyo.com/api/profiles/?filter=equals(email,"${encodeURIComponent(email)}")&fields[profile]=email,properties`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_TOKEN}`,
        'revision': '2024-02-15',
        'Content-Type': 'application/json',
      },
    });

    console.log('Klaviyo response status:', response.status);

    if (!response.ok) {
      const text = await response.text();
      console.error('Klaviyo API error:', response.status, text);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not reach Klaviyo' }) };
    }

    const data = await response.json();
    console.log('Klaviyo response:', JSON.stringify(data));

    const profiles = (data.data) || [];

    if (profiles.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ allowed: false }) };
    }

    /* ── Check if profile has the active subscriber tag ── */
    const REQUIRED_TAG = 'appstle_subscription_active_customer';

    const hasTag = profiles.some(function(profile) {
      const props = profile.attributes && profile.attributes.properties || {};
      /* Klaviyo stores Shopify tags in the shopify_tags property */
      const tags = (props.shopify_tags || props.tags || '').toLowerCase();
      return tags.includes(REQUIRED_TAG.toLowerCase());
    });

    return { statusCode: 200, headers, body: JSON.stringify({ allowed: hasTag }) };

  } catch (err) {
    console.error('Unexpected error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
