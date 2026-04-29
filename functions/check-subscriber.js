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

  const SHOPIFY_STORE   = process.env.SHOPIFY_STORE;
  const SHOPIFY_TOKEN   = process.env.SHOPIFY_TOKEN;

  if (!SHOPIFY_STORE || !SHOPIFY_TOKEN) {
    console.error('Missing environment variables');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  /* ── Product titles that grant access ── */
  const ALLOWED_PRODUCTS = [
    'paper wonders deluxe',
    'paper wonders standard',
    'support the artist',
  ];

  /* ── Check orders via Storefront API GraphQL ── */
  try {
    const query = `
      {
        orders(first: 20, query: "email:${email} created_at:>=${getThirtyDaysAgo()}") {
          edges {
            node {
              lineItems(first: 10) {
                edges {
                  node {
                    title
                  }
                }
              }
            }
          }
        }
      }
    `;

    const response = await fetch(`https://${SHOPIFY_STORE}/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Storefront-Access-Token': SHOPIFY_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    console.log('Storefront API status:', response.status);

    if (!response.ok) {
      const text = await response.text();
      console.error('Storefront API error:', response.status, text);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not reach Shopify' }) };
    }

    const data = await response.json();
    console.log('Storefront response:', JSON.stringify(data));

    const orders = (data.data && data.data.orders && data.data.orders.edges) || [];

    /* ── Check if any order contains one of the allowed products ── */
    const hasAccess = orders.some(function(orderEdge) {
      const lineItems = (orderEdge.node.lineItems && orderEdge.node.lineItems.edges) || [];
      return lineItems.some(function(itemEdge) {
        const title = (itemEdge.node.title || '').toLowerCase();
        return ALLOWED_PRODUCTS.some(function(allowed) {
          return title.includes(allowed);
        });
      });
    });

    return { statusCode: 200, headers, body: JSON.stringify({ allowed: hasAccess }) };

  } catch (err) {
    console.error('Unexpected error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};

function getThirtyDaysAgo() {
  var d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split('T')[0];
}
