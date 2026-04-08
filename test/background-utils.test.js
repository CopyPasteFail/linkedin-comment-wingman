const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    getChatGptPopupOptions,
    createActiveTaskFromWindow
} = require("../src/background-utils.js");

test("getChatGptPopupOptions opens the ChatGPT popup without stealing focus", () => {
    assert.deepEqual(getChatGptPopupOptions(), {
        url: "https://chatgpt.com/?model=gpt-4",
        type: "popup",
        width: 500,
        height: 700,
        focused: false,
        state: "normal"
    });
});

test("background service worker fallback keeps the ChatGPT popup unfocused", () => {
    const backgroundSource = fs.readFileSync(path.join(__dirname, "..", "src", "background.js"), "utf8");
    const popupOptionsBlockMatch = backgroundSource.match(/getChatGptPopupOptions\(\)\s*\{\s*return\s*\{[\s\S]*?\}\s*;\s*\}/);

    assert.ok(popupOptionsBlockMatch);
    assert.match(popupOptionsBlockMatch[0], /focused:\s*false/);
    assert.match(popupOptionsBlockMatch[0], /state:\s*"normal"/);
    assert.doesNotMatch(popupOptionsBlockMatch[0], /focused:\s*true/);
    assert.doesNotMatch(popupOptionsBlockMatch[0], /state:\s*"minimized"/);
    assert.doesNotMatch(backgroundSource, /sendChatGptPopupToBackground/);
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
