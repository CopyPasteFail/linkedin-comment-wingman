# LinkedIn Comment Wingman

A Chrome extension that generates AI-powered comment suggestions for LinkedIn posts using your active ChatGPT session.

## Prerequisites

- **You must be logged into LinkedIn** in the same Chrome profile where the extension is installed.
- **You must be logged into ChatGPT** (`chatgpt.com`) in the same Chrome profile. The extension opens ChatGPT in a popup and uses your existing session — no API key required.

## Installation

### Install from GitHub Release

1. Open the latest GitHub Release for this project.
2. Download the `.crx` file if you want the simplest install path to try first.
3. If Chrome accepts the `.crx`, open it and follow Chrome's install prompt.
4. If Chrome blocks the `.crx`, download the `.zip` file instead and use the fallback steps below.

### Fallback: install from ZIP as unpacked extension

1. Download the release `.zip` file.
2. Extract it to a folder on your computer.
3. Open Chrome and navigate to `chrome://extensions`.
4. Enable **Developer mode** (toggle in the top right).
5. Click **Load unpacked** and select the extracted folder that contains `manifest.json`.

### Install from source

1. Clone this repository or download the source.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top right).
4. Click **Load unpacked** and select the root folder of this repository.

## Usage

1. Go to your LinkedIn feed.
2. Find any post and click the **✨ Wingman** button that appears next to the native Comment button.
3. A ChatGPT popup opens, generates comment options, and closes automatically.
4. Click any suggested comment to copy it to your clipboard, then paste it into the LinkedIn comment box.

## Why The ChatGPT Popup Stays In The Foreground

Wingman intentionally keeps the ChatGPT popup focused while generation runs.

This is not just a UX choice. In practice, hidden or unfocused ChatGPT popups can render more slowly, delay hydration, or expose incomplete assistant DOM content. That caused extraction to race ahead of the final response and made the extension unreliable unless the popup was brought to the foreground manually.

Keeping the popup in the foreground gives Wingman the most reliable desktop ChatGPT layout and the most stable response extraction path.

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
