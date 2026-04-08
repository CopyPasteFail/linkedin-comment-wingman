/* global module */

const PROMPT_KEYWORDS = [
    "# Role",
    "# Core objective",
    "# Tone",
    "# Core comment strategy",
    "# Specificity rule",
    "# Builder / operator credibility",
    "# Ecosystem lens",
    "# Emotional matching rule",
    "# Conversational naturalness",
    "# Humor rule",
    "# Style variation rule",
    "# Output count",
    "# Writing rules",
    "# Output format",
    "# Quality standard",
    "HERE IS THE LINKEDIN POST"
];

function trimPromptNoise(text) {
    let cleanText = text;

    const firstOptionIndex = text.search(/option 1/i);
    const firstCodeBlockIndex = text.indexOf("```");
    if (firstOptionIndex !== -1 || firstCodeBlockIndex !== -1) {
        const startIndex = (firstOptionIndex !== -1 && (firstCodeBlockIndex === -1 || firstOptionIndex < firstCodeBlockIndex))
            ? firstOptionIndex
            : firstCodeBlockIndex;

        if (startIndex > 50) {
            cleanText = text.substring(startIndex);
        }
    }

    const lastOptionMatch = [...cleanText.matchAll(/option \d+/gi)].pop();
    if (lastOptionMatch) {
        const lastIndex = lastOptionMatch.index;
        const remaining = cleanText.substring(lastIndex);
        if (remaining.includes("ChatGPT can make mistakes") || remaining.includes("# Quality standard")) {
            const lastClosingBlock = remaining.lastIndexOf("```");
            if (lastClosingBlock !== -1) {
                cleanText = cleanText.substring(0, lastIndex + lastClosingBlock + 3);
            }
        }
    }

    return cleanText;
}

function cleanOptionPart(part) {
    return part
        .trim()
        .replace(/^```(?:text|markdown|plain)?\s*/i, "")
        .replace(/^text\s*\n/i, "")
        .replace(/^markdown\s*\n/i, "")
        .replace(/^plain\s*\n/i, "")
        .replace(/\s*```$/i, "")
        .replace(/[\n\r\t\s]+option$/i, "")
        .trim();
}

function parseGeneratedOptions(text) {
    if (!text) {
        return ["Error: Could not extract comments. Please check the ChatGPT popup window."];
    }

    const cleanText = trimPromptNoise(text);
    const options = [];
    const markdownBlockRegex = /option \d+\s*```(?:text)?\s*([\s\S]*?)\s*```/gi;
    let match;

    while ((match = markdownBlockRegex.exec(cleanText)) !== null) {
        const optionText = cleanOptionPart(match[1]);
        if (optionText) {
            options.push(optionText);
        }
    }

    if (options.length > 0) {
        return options;
    }

    const parts = cleanText.split(/\boption \d+[:\s\r\n]*/i);
    parts.forEach((part) => {
        const cleaned = cleanOptionPart(part);
        const looksLikeInstruction = PROMPT_KEYWORDS.some((keyword) => cleaned.includes(keyword)) ||
            cleaned.length < 5 ||
            (cleaned.includes("Return exactly") && cleaned.includes("options"));

        if (!looksLikeInstruction && cleaned.length > 5) {
            options.push(cleaned);
        }
    });

    if (options.length > 0) {
        return options;
    }

    if (cleanText.length > 20 && !cleanText.includes("Error:")) {
        return [cleanText.trim()];
    }

    return ["Error: Could not extract comments. Please check the ChatGPT popup window."];
}

const wingmanLinkedInResults = {
    parseGeneratedOptions
};

if (typeof globalThis !== "undefined") {
    globalThis.WingmanLinkedInResults = wingmanLinkedInResults;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = wingmanLinkedInResults;
}
