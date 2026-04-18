/* global module */

const POST_CONTAINER_SELECTORS = [
    ".feed-shared-update-v2",
    ".update-components-article",
    "article",
    ".occludable-update",
    ".fie-impression-container",
    "[data-urn]"
];

const INTERACTIVE_CONTROL_SELECTOR = "button, [role='button'], a";
const POST_MENU_SELECTOR = '[aria-label*="Open control menu for post by" i]';
const COMMENT_SUBTREE_SELECTOR = [
    ".comments-comments-list",
    ".comments-comment-entity",
    ".comments-comment-list__container",
    ".comment-social-activity",
    ".comments-thread-entity",
    ".comments-thread-item",
    ".feed-shared-update-v2__comments-container"
].join(",");

function isInsideCommentSubtree(node) {
    if (!node || typeof node.closest !== "function") return false;
    return Boolean(node.closest(COMMENT_SUBTREE_SELECTOR));
}

function matchesPostSelector(node) {
    return Boolean(node?.matches) &&
        POST_CONTAINER_SELECTORS.some((selector) => node.matches(selector));
}

function normalizeText(value) {
    return (value || "").trim().toLowerCase();
}

function getInteractiveControls(root) {
    return Array.from(root?.querySelectorAll?.(INTERACTIVE_CONTROL_SELECTOR) || []);
}

function getControlMetadata(control) {
    return {
        text: normalizeText(control?.innerText || control?.textContent || ""),
        aria: normalizeText(control?.getAttribute?.("aria-label") || "")
    };
}

function looksLikeReactionControl(control) {
    const { text, aria } = getControlMetadata(control);
    return text === "like" ||
        text === "open reactions menu" ||
        aria.includes("reaction button state") ||
        aria.includes("open reactions menu") ||
        aria === "like";
}

function looksLikeCommentControl(control) {
    const { text, aria } = getControlMetadata(control);
    return text === "comment" || aria.includes("comment");
}

function looksLikeSocialControl(control) {
    const { text, aria } = getControlMetadata(control);
    return looksLikeReactionControl(control) ||
        looksLikeCommentControl(control) ||
        text === "repost" ||
        aria.includes("repost") ||
        text === "send" ||
        aria.includes("send");
}

function looksLikeNoiseContainer(node) {
    const combined = `${normalizeText(node?.textContent || "")} ${normalizeText(node?.getAttribute?.("aria-label") || "")}`;
    return /report this ad|hide or report this ad|dismiss|load more|full screen|previous page|next page|messaging|jobs|home|my network/.test(combined);
}

function scoreStructuralPostRoot(node) {
    if (!node || looksLikeNoiseContainer(node)) {
        return Number.NEGATIVE_INFINITY;
    }

    const controls = getInteractiveControls(node);
    const hasReaction = controls.some(looksLikeReactionControl);
    const hasSocial = controls.filter(looksLikeSocialControl).length >= 2;
    const hasMenu = Array.from(node?.querySelectorAll?.(POST_MENU_SELECTOR) || []).length > 0;
    const textLength = normalizeText(node?.textContent || "").length;
    const rect = node?.getBoundingClientRect?.();
    const hasCardSize = Boolean(rect && rect.height >= 180);

    let score = 0;
    if (hasReaction) score += 4;
    if (hasMenu) score += 3;
    if (hasSocial) score += 3;
    if (textLength >= 80) score += 2;
    if (hasCardSize) score += 2;
    if (controls.length >= 3) score += 1;
    if (looksLikeNoiseContainer(node)) score -= 6;

    return score;
}

function findPostRootFromReactionAnchor(anchor, bodyNode) {
    let currentNode = anchor?.parentElement || null;
    let depth = 0;
    let bestNode = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    while (currentNode && currentNode !== bodyNode && depth < 10) {
        if (matchesPostSelector(currentNode)) {
            return currentNode;
        }

        const score = scoreStructuralPostRoot(currentNode);
        if (score > bestScore) {
            bestScore = score;
            bestNode = currentNode;
        }

        currentNode = currentNode.parentElement;
        depth++;
    }

    return bestScore >= 6 ? bestNode : null;
}

function collectLikelyPostRoots(documentLike) {
    const roots = new Set();
    const bodyNode = documentLike?.body || null;

    getInteractiveControls(documentLike)
        .filter(looksLikeReactionControl)
        .forEach((anchor) => {
            if (isInsideCommentSubtree(anchor)) return;
            const root = findPostRootFromReactionAnchor(anchor, bodyNode);
            if (root && !isInsideCommentSubtree(root)) {
                roots.add(root);
            }
        });

    Array.from(documentLike?.querySelectorAll?.("article, div, section, main, li") || [])
        .forEach((node) => {
            if (isInsideCommentSubtree(node)) return;
            if (matchesPostSelector(node) || scoreStructuralPostRoot(node) >= 8) {
                roots.add(node);
            }
        });

    return Array.from(roots);
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

    const recoveredFromReaction = findPostRootFromReactionAnchor(startNode, bodyNode);
    if (recoveredFromReaction) {
        return recoveredFromReaction;
    }

    return null;
}

const wingmanLinkedInPostContext = {
    collectLikelyPostRoots,
    resolvePostContainer
};

if (typeof globalThis !== "undefined") {
    globalThis.WingmanLinkedInPostContext = wingmanLinkedInPostContext;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = wingmanLinkedInPostContext;
}
