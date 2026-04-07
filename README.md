# LinkedIn Comment Wingman

A Chrome extension that generates AI-powered comment suggestions for LinkedIn posts using your active ChatGPT session.

## Prerequisites

- **You must be logged into LinkedIn** in the same Chrome profile where the extension is installed.
- **You must be logged into ChatGPT** (`chatgpt.com`) in the same Chrome profile. The extension opens ChatGPT in a popup and uses your existing session — no API key required.

## Installation

1. Clone this repository or download the source.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top right).
4. Click **Load unpacked** and select the root folder of this repository.

## Usage

1. Go to your LinkedIn feed.
2. Find any post and click the **✨ Wingman** button that appears next to the native Comment button.
3. A ChatGPT popup opens, generates comment options, and closes automatically.
4. Click any suggested comment to copy it to your clipboard, then paste it into the LinkedIn comment box.

## How It Works

- The LinkedIn content script injects the Wingman button into the feed.
- Clicking it sends the post text to the background service worker, which opens a ChatGPT popup.
- The ChatGPT content script automates prompt submission and extracts the response.
- Results are delivered back to the LinkedIn page and displayed as clickable cards.

## Development

```bash
npm install
npm run lint      # ESLint check
npm audit         # Dependency security audit
```

Pre-push hook runs lint and audit automatically before every `git push`.
