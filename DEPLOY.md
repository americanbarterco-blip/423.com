# 423.rent on Cloudflare (Worker + static assets)

Folder layout
  wrangler.jsonc        config (vars already filled in)
  package.json
  src/worker.js         the whole /api backend
  public/index.html     the site
  supabase-schema.sql   already applied to your Supabase project (r423_ tables)
  test/smoke.mjs        optional: node test/smoke.mjs

Deploy (from this folder)
  npm install
  npx wrangler login
  npx wrangler secret put SUPABASE_SERVICE_KEY     # service_role key, Supabase > Project Settings > API
  npx wrangler secret put ADMIN_PASS               # admin login password
  npx wrangler secret put STRIPE_SECRET_KEY        # optional until you take payments
  npx wrangler secret put STRIPE_WEBHOOK_SECRET    # optional
  npx wrangler secret put LIVEKIT_URL              # optional (calls)
  npx wrangler secret put LIVEKIT_API_KEY
  npx wrangler secret put LIVEKIT_API_SECRET
  npx wrangler deploy

Custom domain: Cloudflare dashboard > Workers & Pages > 423-rent > Settings > Domains & Routes > add 423.rent
(if 423.rent DNS is on Cloudflare this is one click; otherwise move the DNS first).
Stripe webhook: https://423.rent/api/stripe-webhook  event checkout.session.completed

Notes
- Passwords are hashed with PBKDF2 (Web Crypto). The users table is empty so nothing to migrate.
- Add a Cloudflare rate-limiting rule on /api/auth and /api/admin-login for stronger brute-force protection.
- Secrets can be a "Secret" in the dashboard instead of the CLI: Settings > Variables and Secrets.
