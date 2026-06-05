// Runs on the 1st of every month at midnight UTC
// Netlify cron schedule defined in netlify.toml

exports.handler = async function (event) {
  const SHOPIFY_STORE       = process.env.SHOPIFY_STORE;
  const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_TOKEN) {
    console.error('Missing Shopify env vars');
    return { statusCode: 500, body: 'Server configuration error' };
  }

  console.log('[clear-birthday-tags] Starting monthly cleanup...');

  try {
    let page      = 1;
    let processed = 0;
    let hasMore   = true;
    let pageInfo  = null;

    while (hasMore) {
      // ── Fetch customers tagged "birthday" ──
      let searchUrl;
      if (pageInfo) {
        searchUrl = `https://${SHOPIFY_STORE}/admin/api/2024-01/customers/search.json?query=tag:birthday&fields=id,email,tags&limit=250&page_info=${pageInfo}`;
      } else {
        searchUrl = `https://${SHOPIFY_STORE}/admin/api/2024-01/customers/search.json?query=tag:birthday&fields=id,email,tags&limit=250`;
      }

      const searchRes = await fetch(searchUrl, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
          'Content-Type': 'application/json',
        },
      });

      if (!searchRes.ok) {
        const text = await searchRes.text();
        console.error('Shopify search error:', searchRes.status, text);
        break;
      }

      const data      = await searchRes.json();
      const customers = data.customers || [];

      if (customers.length === 0) {
        hasMore = false;
        break;
      }

      // ── Remove birthday tag from each customer ──
      for (const customer of customers) {
        const existingTags = customer.tags
          ? customer.tags.split(', ').map(t => t.trim()).filter(Boolean)
          : [];

        const newTags = existingTags.filter(t => t !== 'birthday').join(', ');

        const updateUrl = `https://${SHOPIFY_STORE}/admin/api/2024-01/customers/${customer.id}.json`;
        const updateRes = await fetch(updateUrl, {
          method: 'PUT',
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ customer: { id: customer.id, tags: newTags } }),
        });

        if (!updateRes.ok) {
          const text = await updateRes.text();
          console.error(`Failed to update customer ${customer.id}:`, updateRes.status, text);
        } else {
          console.log(`[clear-birthday-tags] Removed birthday tag from customer ${customer.id} (${customer.email})`);
          processed++;
        }
      }

      // ── Check for next page ──
      const linkHeader = searchRes.headers.get('link');
      if (linkHeader && linkHeader.includes('rel="next"')) {
        const match = linkHeader.match(/page_info=([^&>]+).*rel="next"/);
        pageInfo = match ? match[1] : null;
        hasMore  = !!pageInfo;
      } else {
        hasMore = false;
      }
    }

    console.log(`[clear-birthday-tags] Done. Removed birthday tag from ${processed} customers.`);
    return { statusCode: 200, body: `Cleared birthday tag from ${processed} customers.` };

  } catch (err) {
    console.error('Unexpected error:', err);
    return { statusCode: 500, body: 'Internal server error' };
  }
};
