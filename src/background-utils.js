/* global module */

const DEFAULT_POPUP_WIDTH = 252;
const DEFAULT_POPUP_HEIGHT = 368;
const MIN_POPUP_WIDTH = 252;
const MIN_POPUP_HEIGHT = 368;
const DEFAULT_POPUP_MARGIN = 24;
const DEFAULT_POPUP_ZOOM_FACTOR = 0.47;

function clampPopupDimension(value, minimum) {
    return Math.max(minimum, value);
}

function getPopupPosition(screenMetrics, width, height) {
    const availWidth = Number(screenMetrics?.availWidth);
    const availHeight = Number(screenMetrics?.availHeight);
    const availLeft = Number(screenMetrics?.availLeft) || 0;
    const availTop = Number(screenMetrics?.availTop) || 0;

    if (!Number.isFinite(availWidth) || !Number.isFinite(availHeight)) {
        return {};
    }

    return {
        left: Math.max(
            availLeft + DEFAULT_POPUP_MARGIN,
            availLeft + availWidth - width - DEFAULT_POPUP_MARGIN
        ),
        top: Math.max(
            availTop + DEFAULT_POPUP_MARGIN,
            availTop + Math.min(DEFAULT_POPUP_MARGIN, availHeight - height - DEFAULT_POPUP_MARGIN)
        )
    };
}

function getChatGptPopupOptions(screenMetrics) {
    const width = clampPopupDimension(DEFAULT_POPUP_WIDTH, MIN_POPUP_WIDTH);
    const height = clampPopupDimension(DEFAULT_POPUP_HEIGHT, MIN_POPUP_HEIGHT);

    return {
        url: "https://chatgpt.com/?model=gpt-4",
        type: "popup",
        width,
        height,
        focused: true,
        state: "normal",
        ...getPopupPosition(screenMetrics, width, height)
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
    DEFAULT_POPUP_HEIGHT,
    DEFAULT_POPUP_MARGIN,
    DEFAULT_POPUP_WIDTH,
    DEFAULT_POPUP_ZOOM_FACTOR,
    MIN_POPUP_HEIGHT,
    MIN_POPUP_WIDTH,
    getChatGptPopupOptions,
    createActiveTaskFromWindow
};

if (typeof globalThis !== "undefined") {
    globalThis.WingmanBackgroundUtils = wingmanBackgroundUtils;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = wingmanBackgroundUtils;
}
