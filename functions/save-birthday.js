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

  let email, birthday;
  try {
    const body = JSON.parse(event.body);
    email    = (body.email || '').trim().toLowerCase();
    birthday = (body.birthday || '').trim(); // Expected format: "MM-DD"
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email is required' }) };
  }

  // ── Validate MM-DD format ──
  if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(birthday)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid birthday format. Expected MM-DD.' }) };
  }

  const KLAVIYO_TOKEN      = process.env.KLAVIYO_TOKEN;
  const SHOPIFY_STORE      = process.env.SHOPIFY_STORE;
  const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!KLAVIYO_TOKEN) {
    console.error('Missing KLAVIYO_TOKEN');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_TOKEN) {
    console.error('Missing Shopify env vars');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  try {
    // ── Step 1: Look up the Klaviyo profile ──
    const lookupUrl = `https://a.klaviyo.com/api/profiles/?filter=equals(email,"${encodeURIComponent(email)}")&fields[profile]=email,properties`;
    const lookupRes = await fetch(lookupUrl, {
      headers: {
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_TOKEN}`,
        'revision': '2024-02-15',
        'Content-Type': 'application/json',
      },
    });

    if (!lookupRes.ok) {
      const text = await lookupRes.text();
      console.error('Klaviyo lookup error:', lookupRes.status, text);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not reach Klaviyo' }) };
    }

    const lookupData = await lookupRes.json();
    const profiles   = lookupData.data || [];

    if (profiles.length === 0) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Profile not found' }) };
    }

    const profile   = profiles[0];
    const profileId = profile.id;
    const props     = (profile.attributes && profile.attributes.properties) || {};

    // ── Step 2: Enforce lock — birthday can only be set once ──
    if (props['birthday']) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'locked', birthday: props['birthday'] }),
      };
    }

    // ── Step 3: Save birthday to Klaviyo ──
    const updateUrl = `https://a.klaviyo.com/api/profiles/${profileId}/`;
    const updateRes = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_TOKEN}`,
        'revision': '2024-02-15',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          type: 'profile',
          id: profileId,
          attributes: {
            properties: {
              birthday:        birthday,
              birthday_locked: true,
            },
          },
        },
      }),
    });

    if (!updateRes.ok) {
      const text = await updateRes.text();
      console.error('Klaviyo update error:', updateRes.status, text);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Failed to update Klaviyo profile' }) };
    }

    // ── Step 4: Check if birthday month matches current month ──
    const birthdayMonth = parseInt(birthday.split('-')[0], 10);
    const currentMonth  = new Date().getMonth() + 1; // 1-12
    const isBirthdayMonth = birthdayMonth === currentMonth;

    if (isBirthdayMonth) {
      // ── Step 5: Look up Shopify customer by email ──
      const shopifySearchUrl = `https://${SHOPIFY_STORE}/admin/api/2024-01/customers/search.json?query=email:${encodeURIComponent(email)}&fields=id,email,tags`;
      const shopifySearchRes = await fetch(shopifySearchUrl, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
          'Content-Type': 'application/json',
        },
      });

      if (!shopifySearchRes.ok) {
        const text = await shopifySearchRes.text();
        console.error('Shopify customer search error:', shopifySearchRes.status, text);
        // Don't fail the whole request — Klaviyo save succeeded
      } else {
        const shopifyData = await shopifySearchRes.json();
        const customers   = shopifyData.customers || [];

        if (customers.length > 0) {
          const customer      = customers[0];
          const existingTags  = customer.tags ? customer.tags.split(', ').map(t => t.trim()) : [];

          // Add birthday tag if not already present
          if (!existingTags.includes('birthday')) {
            const newTags      = [...existingTags, 'birthday'].join(', ');
            const shopifyUpdateUrl = `https://${SHOPIFY_STORE}/admin/api/2024-01/customers/${customer.id}.json`;
            const shopifyUpdateRes = await fetch(shopifyUpdateUrl, {
              method: 'PUT',
              headers: {
                'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ customer: { id: customer.id, tags: newTags } }),
            });

            if (!shopifyUpdateRes.ok) {
              const text = await shopifyUpdateRes.text();
              console.error('Shopify tag update error:', shopifyUpdateRes.status, text);
            } else {
              console.log(`[birthday] Tagged Shopify customer ${customer.id} (${email})`);
            }
          }
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        birthday,
        birthdayLocked:  true,
        taggedInShopify: isBirthdayMonth,
      }),
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
