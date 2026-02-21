# Fix Directions API "REQUESTS_DENIED"

The backend calls **Directions API** from **Google Cloud Functions** (a server).  
**REQUESTS_DENIED** almost always means the API key you’re using is **restricted so only apps or websites can use it**, not servers.

## Fix: Use a key that allows server use

You need an API key that **is not** restricted to “Android apps”, “iOS apps”, or “HTTP referrers (websites)”. The backend runs on a server, so those restrictions block it.

### Option A: New key only for the backend (recommended)

1. Go to **[APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)** (same project as Firebase).
2. Click **+ Create credentials** → **API key**.
3. Copy the new key and put it in `functions/.env` as `GOOGLE_MAPS_API_KEY=...`.
4. Click the key name to edit it:
   - **Application restrictions**: choose **None** (so Cloud Functions can use it).
   - **API restrictions**: choose **Restrict key** and enable only **Directions API**.
5. Save.

Use this key **only** in the backend (`.env`). Keep using your existing key in the Android/iOS apps for the map.

### Option B: Change your existing key (only if it’s not used by the apps)

If the key in `GOOGLE_MAPS_API_KEY` is **not** used by Android or iOS:

1. Go to **[Credentials](https://console.cloud.google.com/apis/credentials)** and open that key.
2. Set **Application restrictions** to **None**.
3. Under **API restrictions**, enable **Directions API** (and any others you need).
4. Save.

If the same key is used by the mobile apps and it’s set to “Android apps” or “iOS apps”, **do not** set it to None or you weaken app security. Use **Option A** and a separate key for the backend.

## Also check

- **Directions API** is enabled:
  - Open the **API Library** (not Credentials): [APIs & Services → Library](https://console.cloud.google.com/apis/library).
  - In the search box, type **Directions**.
  - Open **"Directions API"** (or "Directions API (Legacy)") and click **Enable**.
  - Or use this direct link (choose your project first):  
    [Enable Directions API](https://console.cloud.google.com/apis/library/directions-backend.googleapis.com).
- **Billing** is enabled for the project: [Billing](https://console.cloud.google.com/billing).
- After changing the key or restrictions, wait a minute and redeploy: `firebase deploy --only functions`.
