# Stockz

Static site, no build step.

Deploy on Vercel: put ALL files of this folder at the root of the GitHub repo (index.html must be at the root),
import the repo in Vercel, Framework preset = Other, no build command, no output directory.

- Live data: BNB Smart Chain mainnet, read in the visitor's browser through public RPCs (config.js).
- Stock pairs: detected from each token's creation transaction using the 88 stock addresses in config.js.
- Launch: tokens are created on the platform. The creator signs in their own wallet; every launch is simulated first.
- api/upload.js is a Vercel Edge Function (picked up automatically from the /api folder) that pins the image + details for the token.
- Fail closed: if the chain cannot be read the map shows no buildings and says why.

Privy (optional login with email / Google / X and embedded wallets):
1. Create an app at https://dashboard.privy.io and copy its App ID.
2. Paste it into config.js -> privyAppId.
3. In the Privy dashboard, add your Vercel domain to the allowed domains.
Without an App ID the site uses browser wallets only.
