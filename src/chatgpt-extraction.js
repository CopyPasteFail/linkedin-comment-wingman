/* global module */

const STATUS_MARKERS = [
    "Pending",
    "Searching",
    "Analyzing",
    "Finished searching",
    "Memory updated",
    "Thought for",
    "seconds"
];

const PROMPT_ARTIFACT_KEYWORDS = [
    "# Role",
    "# Core objective",
    "# Output format",
    "# Quality standard",
    "HERE IS THE LINKEDIN POST",
    "ONLY return the options.",
    "Formatting rules:",
    "...and so on up to option 8"
];

const TURN_SELECTORS = [
    '[data-testid^="conversation-turn-"]',
    '[data-message-author-role]',
    '.agent-turn',
    '.turn-assistant',
    'article[data-testid^="conversation-turn-"]',
    'article[data-message-author-role]'
];

function stripStatusMarkers(text) {
    let cleanedText = (text || "").trim();

    STATUS_MARKERS.forEach((marker) => {
        const startPattern = new RegExp(`^${marker}[\\s\\n\\r.:]*`, "i");
        const endPattern = new RegExp(`[\\s\\n\\r.:]*${marker}$`, "i");
        cleanedText = cleanedText.replace(startPattern, "").replace(endPattern, "").trim();
    });

    return cleanedText;
}

function isLikelyPromptTemplate(text) {
    const cleanedText = stripStatusMarkers(text);
    const keywordHits = PROMPT_ARTIFACT_KEYWORDS
        .filter((keyword) => cleanedText.includes(keyword))
        .length;

    return keywordHits >= 2 ||
        (cleanedText.includes("# Role") && cleanedText.includes("option 1")) ||
        cleanedText.includes("Return exactly this structure:");
}

function looksLikeUsefulAssistantText(text) {
    const cleanedText = stripStatusMarkers(text);
    const normalizedText = cleanedText.trim().toLowerCase();

    if (cleanedText.length < 30) {
        return false;
    }

    if (isLikelyPromptTemplate(cleanedText)) {
        return false;
    }

    return !isUiChromeText(normalizedText);
}

function shouldAcceptPrimaryExtractionCandidate({ text, isAssistantTurn }) {
    return Boolean(isAssistantTurn) && looksLikeUsefulAssistantText(text);
}

function shouldAcceptAssistantFallback(text) {
    return looksLikeUsefulAssistantText(text);
}

function isLikelyConversationTurnElement(element) {
    if (!element) {
        return false;
    }

    const className = String(element.className || "");
    if (/composer/i.test(className) || element.closest?.("form")) {
        return false;
    }

    const testId = element.getAttribute?.("data-testid") || "";
    const role = element.getAttribute?.("data-message-author-role") || "";

    return Boolean(role) ||
        testId.startsWith("conversation-turn-") ||
        element.classList?.contains("agent-turn") ||
        element.classList?.contains("turn-assistant");
}

function collectTurns(documentLike) {
    const turns = new Set();

    TURN_SELECTORS.forEach((selector) => {
        documentLike.querySelectorAll(selector).forEach((element) => {
            if (isLikelyConversationTurnElement(element)) {
                turns.add(element);
            }
        });
    });

    return Array.from(turns);
}

function getUniqueNodeTexts(nodeList) {
    const uniqueTexts = new Set();

    Array.from(nodeList || []).forEach((node) => {
        const text = stripStatusMarkers(node?.innerText || node?.textContent || "");
        if (text && !isLikelyPromptTemplate(text)) {
            uniqueTexts.add(text);
        }
    });

    return Array.from(uniqueTexts);
}

function formatOptionBlocks(blocks) {
    return blocks.map((blockText, index) => [
        `option ${index + 1}`,
        "```text",
        blockText,
        "```"
    ].join("\n")).join("\n\n");
}

function isOptionLabel(text) {
    return /^option\s+\d+$/i.test(text.trim());
}

function isUiChromeText(text) {
    const normalizedText = text.trim().toLowerCase();
    return normalizedText === "copy" ||
        normalizedText === "share" ||
        normalizedText === "chatgpt can make mistakes. check important info." ||
        normalizedText === "thinking";
}

function getRenderedTextBlocks(turn) {
    const selectAll = (selector) => Array.from(turn?.querySelectorAll?.(selector) || []);
    const renderedTexts = getUniqueNodeTexts([
        ...selectAll('[dir="auto"]'),
        ...selectAll(".whitespace-pre-wrap"),
        ...selectAll("p"),
        ...selectAll("li"),
        ...selectAll('[data-message-author-role="assistant"] [dir="auto"]')
    ]);

    return renderedTexts.filter((text) => (
        !isOptionLabel(text) &&
        !isUiChromeText(text) &&
        text.length > 20
    ));
}

function extractMeaningfulTextFromTurn(turn) {
    if (!turn) {
        return "";
    }

    const documentLike = turn.ownerDocument || globalThis.document;
    const nodeFilter = globalThis.NodeFilter;
    const createTreeWalker = documentLike?.createTreeWalker;

    if (!createTreeWalker || !nodeFilter) {
        return "";
    }

    const chunks = [];
    const walker = createTreeWalker.call(documentLike, turn, nodeFilter.SHOW_TEXT);
    let node = walker.nextNode();

    while (node) {
        const text = stripStatusMarkers(node.nodeValue || "").trim();
        const parent = node.parentElement;
        const isHidden = parent?.getAttribute?.("aria-hidden") === "true" ||
            parent?.hidden ||
            parent?.closest?.("[hidden], [aria-hidden=\"true\"]");
        const isChrome = parent?.closest?.("button, svg, nav, form, textarea, script, style");

        if (
            text &&
            parent &&
            !isHidden &&
            !isChrome &&
            !isUiChromeText(text) &&
            !isLikelyPromptTemplate(text)
        ) {
            chunks.push(text);
        }

        node = walker.nextNode();
    }

    const mergedText = chunks.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return looksLikeUsefulAssistantText(mergedText) ? mergedText : "";
}

function extractAssistantTurnText(turn) {
    const rawTurnText = stripStatusMarkers(turn?.innerText || turn?.textContent || "");
    if (shouldAcceptAssistantFallback(rawTurnText)) {
        return rawTurnText;
    }

    const selectAll = (selector) => Array.from(turn?.querySelectorAll?.(selector) || []);
    const codeBlockTexts = getUniqueNodeTexts([
        ...selectAll("pre code"),
        ...selectAll("pre"),
        ...selectAll('[data-testid*="code"]'),
        ...selectAll("code")
    ]);

    if (codeBlockTexts.length > 0) {
        return formatOptionBlocks(codeBlockTexts);
    }

    const renderedTextBlocks = getRenderedTextBlocks(turn);
    if (renderedTextBlocks.length > 0) {
        return formatOptionBlocks(renderedTextBlocks);
    }

    const treeWalkerText = extractMeaningfulTextFromTurn(turn);
    if (treeWalkerText) {
        return treeWalkerText;
    }

    return "";
}

function extractDocumentResponseText(documentLike) {
    const pageText = stripStatusMarkers(
        documentLike?.body?.innerText ||
        documentLike?.body?.textContent ||
        ""
    );

    return looksLikeUsefulAssistantText(pageText) ? pageText : "";
}

const wingmanChatGptExtraction = {
    collectTurns,
    extractDocumentResponseText,
    extractAssistantTurnText,
    extractMeaningfulTextFromTurn,
    isLikelyPromptTemplate,
    looksLikeUsefulAssistantText,
    shouldAcceptAssistantFallback,
    shouldAcceptPrimaryExtractionCandidate,
    stripStatusMarkers
};

if (typeof globalThis !== "undefined") {
    globalThis.WingmanChatGptExtraction = wingmanChatGptExtraction;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = wingmanChatGptExtraction;
}
