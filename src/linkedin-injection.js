/* global module */

function normalizeText(value) {
    return (value || "").trim().toLowerCase();
}

function isExplicitCommentMatch({ ariaLabel, textContent }) {
    const normalizedAria = normalizeText(ariaLabel);
    const normalizedText = normalizeText(textContent);

    return normalizedText === "comment" ||
        normalizedText === "הגב" ||
        normalizedAria === "comment" ||
        normalizedAria === "הגב" ||
        normalizedAria.startsWith("comment on");
}

function isStructuralCommentMatch({
    buttonIndex,
    actionButtonCount,
    hasCommentComposer
}) {
    return hasCommentComposer && buttonIndex === 1 && actionButtonCount >= 3 && actionButtonCount <= 5;
}

function isLikelyCommentButton(metadata) {
    return isExplicitCommentMatch(metadata) || isStructuralCommentMatch(metadata);
}

const wingmanLinkedInInjection = {
    isExplicitCommentMatch,
    isStructuralCommentMatch,
    isLikelyCommentButton
};

if (typeof globalThis !== "undefined") {
    globalThis.WingmanLinkedInInjection = wingmanLinkedInInjection;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = wingmanLinkedInInjection;
}
