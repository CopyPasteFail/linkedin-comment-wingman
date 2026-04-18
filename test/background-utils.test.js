const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    DEFAULT_POPUP_HEIGHT,
    DEFAULT_POPUP_MARGIN,
    DEFAULT_POPUP_WIDTH,
    DEFAULT_POPUP_ZOOM_FACTOR,
    MIN_POPUP_HEIGHT,
    MIN_POPUP_WIDTH,
    getChatGptPopupOptions,
    createActiveTaskFromWindow
} = require("../src/background-utils.js");

test("getChatGptPopupOptions opens the ChatGPT popup focused with desktop-safe dimensions", () => {
    assert.deepEqual(getChatGptPopupOptions(), {
        url: "https://chatgpt.com/?model=gpt-4",
        type: "popup",
        width: 252,
        height: 368,
        focused: true,
        state: "normal"
    });
});

test("getChatGptPopupOptions keeps popup sizing above the desktop-safe minimums and positions near the edge", () => {
    const popupOptions = getChatGptPopupOptions({
        availWidth: 1440,
        availHeight: 900,
        availLeft: 0,
        availTop: 0
    });

    assert.equal(DEFAULT_POPUP_WIDTH, 252);
    assert.equal(DEFAULT_POPUP_HEIGHT, 368);
    assert.equal(MIN_POPUP_WIDTH, 252);
    assert.equal(MIN_POPUP_HEIGHT, 368);
    assert.equal(DEFAULT_POPUP_MARGIN, 24);
    assert.equal(DEFAULT_POPUP_ZOOM_FACTOR, 0.47);
    assert.equal(popupOptions.width >= MIN_POPUP_WIDTH, true);
    assert.equal(popupOptions.height >= MIN_POPUP_HEIGHT, true);
    assert.equal(popupOptions.left, 1440 - popupOptions.width - DEFAULT_POPUP_MARGIN);
    assert.equal(popupOptions.top, DEFAULT_POPUP_MARGIN);
});

test("background service worker fallback keeps the ChatGPT popup focused and desktop-sized", () => {
    const backgroundSource = fs.readFileSync(path.join(__dirname, "..", "src", "background.js"), "utf8");
    const popupOptionsBlockMatch = backgroundSource.match(/getChatGptPopupOptions\(\)\s*\{[\s\S]*?return\s*\{[\s\S]*?\}\s*;\s*\}/);

    assert.ok(popupOptionsBlockMatch);
    assert.match(backgroundSource, /DEFAULT_POPUP_WIDTH:\s*252/);
    assert.match(backgroundSource, /DEFAULT_POPUP_HEIGHT:\s*368/);
    assert.match(backgroundSource, /MIN_POPUP_WIDTH:\s*252/);
    assert.match(backgroundSource, /MIN_POPUP_HEIGHT:\s*368/);
    assert.match(backgroundSource, /DEFAULT_POPUP_ZOOM_FACTOR:\s*0\.47/);
    assert.match(backgroundSource, /applyChatGptPopupPresentation/);
    assert.match(backgroundSource, /chrome\.tabs\.setZoom/);
    assert.match(popupOptionsBlockMatch[0], /focused:\s*true/);
    assert.match(popupOptionsBlockMatch[0], /state:\s*"normal"/);
    assert.doesNotMatch(popupOptionsBlockMatch[0], /focused:\s*false/);
    assert.doesNotMatch(popupOptionsBlockMatch[0], /state:\s*"minimized"/);
    assert.doesNotMatch(backgroundSource, /sendChatGptPopupToBackground/);
});

test("background service worker fallback does not depend on method binding for popup helpers", () => {
    const backgroundSource = fs.readFileSync(path.join(__dirname, "..", "src", "background.js"), "utf8");

    assert.doesNotMatch(backgroundSource, /this\.clampPopupDimension/);
    assert.doesNotMatch(backgroundSource, /this\.getPopupPosition/);
    assert.doesNotMatch(backgroundSource, /this\.DEFAULT_POPUP_MARGIN/);
});

test("background service worker formats special instructions as a global preference block", () => {
    const backgroundSource = fs.readFileSync(path.join(__dirname, "..", "src", "background.js"), "utf8");

    assert.match(backgroundSource, /# Global preference for this generation/);
    assert.match(backgroundSource, /Apply the following to every option/);
    assert.match(
        backgroundSource,
        /## Preference\\n\$\{specialInstructions\}\\n\\n/
    );
    assert.doesNotMatch(backgroundSource, /# User preference for this generation/);
});

test("createActiveTaskFromWindow returns null when Chrome does not provide a usable popup tab", () => {
    const task = createActiveTaskFromWindow(null, "prompt", 42, "wingman-post-1");
    assert.equal(task, null);

    const missingTabsTask = createActiveTaskFromWindow({ id: 11, tabs: [] }, "prompt", 42, "wingman-post-1");
    assert.equal(missingTabsTask, null);
});

test("createActiveTaskFromWindow builds the task payload from the created popup", () => {
    const task = createActiveTaskFromWindow(
        {
            id: 11,
            tabs: [{ id: 22 }]
        },
        "prompt",
        42,
        "wingman-post-1"
    );

    assert.deepEqual(task, {
        windowId: 11,
        tabId: 22,
        prompt: "prompt",
        senderTabId: 42,
        targetNodeId: "wingman-post-1"
    });
});
