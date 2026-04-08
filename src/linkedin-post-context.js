/* global module */

const POST_CONTAINER_SELECTORS = [
    ".feed-shared-update-v2",
    ".update-components-article",
    "article",
    ".occludable-update",
    ".fie-impression-container",
    "[data-urn]"
];

function matchesPostSelector(node) {
    return Boolean(node?.matches) &&
        POST_CONTAINER_SELECTORS.some((selector) => node.matches(selector));
}

function resolvePostContainer(startNode, actionBar, bodyNode) {
    let currentNode = startNode;

    while (currentNode && currentNode !== bodyNode) {
        if (matchesPostSelector(currentNode)) {
            return currentNode;
        }
        currentNode = currentNode.parentElement;
    }

    currentNode = actionBar?.parentElement || null;
    let depth = 0;
    while (currentNode && currentNode !== bodyNode && depth < 6) {
        if (matchesPostSelector(currentNode)) {
            return currentNode;
        }
        currentNode = currentNode.parentElement;
        depth++;
    }

    return null;
}

const wingmanLinkedInPostContext = {
    resolvePostContainer
};

if (typeof globalThis !== "undefined") {
    globalThis.WingmanLinkedInPostContext = wingmanLinkedInPostContext;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = wingmanLinkedInPostContext;
}
