# PixelPulse Funnel Recorder — Chrome Extension

A **Manifest V3** Chrome extension that lets you click-record your signup or
checkout funnel once. PixelPulse then imports the recording and replays it on
a schedule with a headless browser to verify that your GA4, Meta Pixel, Google
Ads, and Stripe conversion events are still firing.

---

## How to load the extension (unpacked)

> Requires Chrome 112 + (or any Chromium-based browser with MV3 support).

1. **Build** (optional — the TypeScript files must be compiled before loading):

   ```bash
   cd packages/recorder-extension
   npx esbuild background.ts --bundle --outfile=background.js --format=esm
   npx esbuild popup.ts     --bundle --outfile=popup.js     --format=esm
   npx esbuild content.ts   --bundle --outfile=content.js   --format=esm
   ```

   If you don't have esbuild installed add it with `npm i -g esbuild`.

2. Open **chrome://extensions** in Chrome.

3. Enable **Developer mode** (toggle in the top-right corner).

4. Click **"Load unpacked"** and select the `packages/recorder-extension`
   folder.

5. Pin the PixelPulse icon to the toolbar for easy access.

---

## Recording a funnel

1. Navigate to the **first page** of your funnel (e.g., `/signup` or `/checkout`).
2. Click the **PixelPulse** toolbar icon to open the popup.
3. Click **▶ Start** — the status pill turns red and shows **● REC**.
4. Use your site normally:
   - Click buttons and links.
   - Fill in forms (passwords are never captured).
   - Navigate across pages.
5. When you reach the **confirmation / thank-you page**, click **■ Stop**.
6. Review the captured steps in the popup list.
7. Click **↙ Export JSON** to download a `pixelpulse-funnel-<timestamp>.json`
   file.

---

## Importing the JSON into PixelPulse

1. Log in to your PixelPulse dashboard at **pixelpulse.app**.
2. Open or create a **Monitor**.
3. In the **Funnel Steps** section, click **Import from JSON**.
4. Upload the exported file.
5. Map each step to the expected pixel events (GA4 / Meta / Google Ads /
   Stripe) using the event-assertion UI.
6. Save — PixelPulse will now replay your funnel every 15 minutes.

---

## Exported JSON format

Each item in the exported array is a **funnel step** object with these fields:

| Field        | Type   | Description |
|--------------|--------|-------------|
| `actionType` | string | `click` \| `fill` \| `navigate` \| `wait` |
| `selector`   | string | CSS selector of the target element (empty for navigate/wait) |
| `value`      | string | Text typed (fill), wait duration in ms (wait), or empty string |
| `url`        | string | Full URL of the page when the action was recorded |

**Example:**

```json
[
  {
    "actionType": "navigate",
    "selector": "",
    "value": "",
    "url": "https://yourapp.com/signup"
  },
  {
    "actionType": "fill",
    "selector": "#email",
    "value": "user@example.com",
    "url": "https://yourapp.com/signup"
  },
  {
    "actionType": "fill",
    "selector": "#password",
    "value": "",
    "url": "https://yourapp.com/signup"
  },
  {
    "actionType": "click",
    "selector": "#signup-btn",
    "value": "",
    "url": "https://yourapp.com/signup"
  },
  {
    "actionType": "navigate",
    "selector": "",
    "value": "",
    "url": "https://yourapp.com/dashboard"
  }
]
```

> **Note:** Password fields are intentionally blanked (`"value": ""`) to avoid
> capturing sensitive data.  When PixelPulse replays the funnel it uses the
> test credentials you configure in the monitor settings.

---

## Permissions

| Permission   | Reason |
|--------------|--------|
| `activeTab`  | Inject the content script into the currently active tab on demand |
| `scripting`  | Programmatically inject / execute scripts |
| `storage`    | Persist recorded steps and recording state across popup sessions |
| `<all_urls>` | Allow the content script to run on any site you're recording |

---

## Privacy

- The extension does **not** transmit data to any server during recording.
- Recorded steps are stored locally in `chrome.storage.local`.
- Password fields are never captured (`type="password"` inputs are blanked).
- The exported JSON goes directly from your browser to the PixelPulse dashboard
  when you upload it; no relay server is involved.
