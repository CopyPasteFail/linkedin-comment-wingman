/* global module */

const DEFAULT_LAYOUT_CONFIG = {
    desktopMinViewport: 1180,
    minPanelWidth: 320,
    maxPanelWidth: 380,
    gap: 24,
    topOffset: 96,
    viewportMargin: 16,
    minPanelHeight: 220
};

function getNextActivePostId(currentPostId, clickedPostId) {
    return currentPostId === clickedPostId ? null : clickedPostId;
}

function getCompanionLayout({ viewportWidth, viewportHeight, postRect, config = {} }) {
    const settings = { ...DEFAULT_LAYOUT_CONFIG, ...config };

    if (!postRect || viewportWidth < settings.desktopMinViewport) {
        return { mode: "inline" };
    }

    const availableRight = viewportWidth - postRect.right - settings.gap - settings.viewportMargin;
    if (availableRight < settings.minPanelWidth) {
        return { mode: "inline" };
    }

    const width = Math.min(settings.maxPanelWidth, availableRight);
    const maxTop = Math.max(settings.topOffset, viewportHeight - settings.minPanelHeight - settings.viewportMargin);
    const top = Math.max(settings.topOffset, Math.min(postRect.top, maxTop));
    const left = Math.min(
        viewportWidth - settings.viewportMargin - width,
        postRect.right + settings.gap
    );
    const maxHeight = Math.max(
        settings.minPanelHeight,
        viewportHeight - top - settings.viewportMargin
    );

    return {
        mode: "side",
        width,
        top,
        left,
        maxHeight
    };
}

const wingmanLinkedInUi = {
    DEFAULT_LAYOUT_CONFIG,
    getCompanionLayout,
    getNextActivePostId
};

if (typeof globalThis !== "undefined") {
    globalThis.WingmanLinkedInUi = wingmanLinkedInUi;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = wingmanLinkedInUi;
}
