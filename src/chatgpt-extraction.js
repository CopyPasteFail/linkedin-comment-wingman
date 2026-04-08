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

function shouldAcceptPrimaryExtractionCandidate({ text, isAssistantTurn }) {
    const cleanedText = stripStatusMarkers(text);
    const hasOption1 = /option 1/i.test(cleanedText);
    const hasOption2 = /option 2/i.test(cleanedText);
    const hasOption3 = /option 3/i.test(cleanedText);
    const hasCodeFence = /```(?:text)?/i.test(cleanedText);

    if (!isAssistantTurn || cleanedText.length <= 30 || isLikelyPromptTemplate(cleanedText)) {
        return false;
    }

    return (hasOption1 && hasOption2) || (hasOption1 && hasOption3) || (hasOption1 && hasCodeFence);
}

function shouldAcceptAssistantFallback(text) {
    const cleanedText = stripStatusMarkers(text);
    return cleanedText.length > 50 && !isLikelyPromptTemplate(cleanedText);
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

    return "";
}

function extractDocumentResponseText(documentLike) {
    const pageText = stripStatusMarkers(
        documentLike?.body?.innerText ||
        documentLike?.body?.textContent ||
        ""
    );

    if (pageText.length > 50 && /option\s+\d+/i.test(pageText) && !isLikelyPromptTemplate(pageText)) {
        return pageText;
    }

    return "";
}

const wingmanChatGptExtraction = {
    collectTurns,
    extractDocumentResponseText,
    extractAssistantTurnText,
    isLikelyPromptTemplate,
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
