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
  const SHOPIFY_STORE   = process.env.SHOPIFY_STORE;   // e.g. your-store.myshopify.com
  const SHOPIFY_TOKEN   = process.env.SHOPIFY_TOKEN;   // Admin API access token
  const REQUIRED_TAG    = process.env.REQUIRED_TAG || 'appstle_subscription_active_customer';

  if (!SHOPIFY_STORE || !SHOPIFY_TOKEN) {
    console.error('Missing SHOPIFY_STORE or SHOPIFY_TOKEN environment variables');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  /* ── Query Shopify Admin API for the customer ── */
  try {
    const url = `https://${SHOPIFY_STORE}/admin/api/2024-01/customers/search.json?query=email:${encodeURIComponent(email)}&fields=id,email,tags`;

    const response = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('Shopify API error:', response.status, await response.text());
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not reach Shopify' }) };
    }

    const data = await response.json();
    const customers = data.customers || [];

    /* ── No customer found with that email ── */
    if (customers.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ allowed: false }) };
    }

    /* ── Check if any matching customer has the required tag ── */
    const hasTag = customers.some(function (customer) {
      const tags = (customer.tags || '').split(',').map(function (t) { return t.trim().toLowerCase(); });
      return tags.includes(REQUIRED_TAG.toLowerCase());
    });

    return { statusCode: 200, headers, body: JSON.stringify({ allowed: hasTag }) };

  } catch (err) {
    console.error('Unexpected error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
