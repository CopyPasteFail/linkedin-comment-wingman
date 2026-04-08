/* global module */

function getChatGptPopupOptions() {
    return {
        url: "https://chatgpt.com/?model=gpt-4",
        type: "popup",
        width: 500,
        height: 700,
        focused: false,
        state: "normal"
    };
}

function createActiveTaskFromWindow(createdWindow, prompt, senderTabId, targetNodeId) {
    const createdTab = createdWindow?.tabs?.[0];
    if (!createdWindow?.id || !createdTab?.id) {
        return null;
    }

    return {
        windowId: createdWindow.id,
        tabId: createdTab.id,
        prompt,
        senderTabId,
        targetNodeId
    };
}

const wingmanBackgroundUtils = {
    getChatGptPopupOptions,
    createActiveTaskFromWindow
};

if (typeof globalThis !== "undefined") {
    globalThis.WingmanBackgroundUtils = wingmanBackgroundUtils;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = wingmanBackgroundUtils;
}
