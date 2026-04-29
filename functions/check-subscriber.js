exports.handler = async function (event) {
  /* ── CORS headers ── */
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  /* ── Handle CORS preflight request ── */
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  /* ── Only allow POST requests ── */
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  /* ── Parse the email from the request body ── */
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

  /* ── Pull credentials from Netlify environment variables ── */
  const APPSTLE_TOKEN = process.env.APPSTLE_TOKEN;
  const SHOPIFY_STORE = process.env.SHOPIFY_STORE;

  if (!APPSTLE_TOKEN || !SHOPIFY_STORE) {
    console.error('Missing APPSTLE_TOKEN or SHOPIFY_STORE environment variables');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  /* ── Query Appstle API for active subscriptions by email ── */
  try {
    const url = `https://subscription-admin.appstle.com/api/external/v1/subscriptions?email=${encodeURIComponent(email)}&status=ACTIVE`;

    const response = await fetch(url, {
      headers: {
        'Authorization': 'Bearer ' + APPSTLE_TOKEN,
        'X-Store-Domain': SHOPIFY_STORE,
        'Content-Type': 'application/json',
      },
    });

    console.log('Appstle response status:', response.status);

    if (!response.ok) {
      const text = await response.text();
      console.error('Appstle API error:', response.status, text);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not reach Appstle' }) };
    }

    const data = await response.json();
    console.log('Appstle response:', JSON.stringify(data));

    /* ── Check if any active subscriptions exist for this email ── */
    const hasActiveSubscription = Array.isArray(data) ? data.length > 0 :
      (data.content && data.content.length > 0) ||
      (data.subscriptions && data.subscriptions.length > 0);

    return { statusCode: 200, headers, body: JSON.stringify({ allowed: hasActiveSubscription }) };

  } catch (err) {
    console.error('Unexpected error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
