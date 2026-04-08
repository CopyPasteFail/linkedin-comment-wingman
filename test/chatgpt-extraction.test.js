const test = require("node:test");
const assert = require("node:assert/strict");

const {
    collectTurns,
    extractDocumentResponseText,
    extractAssistantTurnText,
    findLastAssistantTurn,
    isLikelyPromptTemplate,
    shouldAcceptAssistantFallback,
    shouldAcceptPrimaryExtractionCandidate,
    stripStatusMarkers
} = require("../src/chatgpt-extraction.js");

test("stripStatusMarkers removes transient leading and trailing status text", () => {
    const text = "Thought for a couple of seconds\n\noption 1\n```text\nreal comment\n```";

    assert.equal(
        stripStatusMarkers(text),
        "a couple of seconds\n\noption 1\n```text\nreal comment\n```"
    );
});

test("isLikelyPromptTemplate detects the Wingman prompt instructions", () => {
    const text = [
        "# Role",
        "Write short LinkedIn comments",
        "",
        "# Output format",
        "option 1",
        "```text",
        "<comment>",
        "```",
        "",
        "HERE IS THE LINKEDIN POST:"
    ].join("\n");

    assert.equal(isLikelyPromptTemplate(text), true);
});

test("shouldAcceptPrimaryExtractionCandidate rejects user prompt text even when it contains option labels", () => {
    const text = [
        "# Role",
        "Write short LinkedIn comments",
        "",
        "# Output format",
        "option 1",
        "```text",
        "<comment>",
        "```",
        "",
        "option 2",
        "```text",
        "<comment>",
        "```"
    ].join("\n");

    assert.equal(shouldAcceptPrimaryExtractionCandidate({
        text,
        isAssistantTurn: false
    }), false);
});

test("shouldAcceptPrimaryExtractionCandidate accepts structured assistant output", () => {
    const text = [
        "option 1",
        "```text",
        "This is blunt, but mostly right",
        "```",
        "",
        "option 2",
        "```text",
        "The difference is posture",
        "```"
    ].join("\n");

    assert.equal(shouldAcceptPrimaryExtractionCandidate({
        text,
        isAssistantTurn: true
    }), true);
});

test("shouldAcceptAssistantFallback rejects prompt-shaped assistant text", () => {
    const text = [
        "# Role",
        "Write short LinkedIn comments",
        "",
        "Formatting rules:",
        "- label outside code block"
    ].join("\n");

    assert.equal(shouldAcceptAssistantFallback(text), false);
});

test("collectTurns ignores composer group elements and keeps real conversation turns", () => {
    const assistantTurn = {
        getAttribute(name) {
            return name === "data-message-author-role" ? "assistant" : null;
        },
        className: "turn-assistant",
        classList: {
            contains(className) {
                return className === "turn-assistant";
            }
        },
        closest() {
            return null;
        }
    };
    const composerGroup = {
        getAttribute() {
            return null;
        },
        className: "__composer-pill-composite group relative",
        classList: {
            contains() {
                return false;
            }
        },
        closest(selector) {
            return selector === "form" ? {} : null;
        }
    };
    const documentLike = {
        querySelectorAll(selector) {
            if (selector === '[data-testid^="conversation-turn-"]') {
                return [];
            }

            if (selector === '[data-message-author-role]') {
                return [assistantTurn];
            }

            if (selector === '.agent-turn') {
                return [];
            }

            if (selector === '.turn-assistant') {
                return [assistantTurn];
            }

            return [];
        }
    };

    assert.deepEqual(collectTurns(documentLike), [assistantTurn]);
    assert.equal(collectTurns({
        querySelectorAll() {
            return [composerGroup];
        }
    }).length, 0);
});

test("extractAssistantTurnText synthesizes options from visible code blocks when the outer turn text is not usable", () => {
    const codeNodes = [
        { innerText: "\"wait for the framework\" is basically the corporate version of shipping later" },
        { innerText: "There’s also a hiring signal buried in this\necosystems that reward builders tend to produce more builders" },
        { innerText: "The compounding point is the killer\nin anything model or workflow driven, every week matters" }
    ];
    const turn = {
        innerText: "",
        textContent: "",
        querySelectorAll(selector) {
            if (selector === "pre code" || selector === "pre" || selector === "[data-testid*=\"code\"]" || selector === "code") {
                return codeNodes;
            }
            return [];
        }
    };

    assert.equal(extractAssistantTurnText(turn), [
        "option 1",
        "```text",
        "\"wait for the framework\" is basically the corporate version of shipping later",
        "```",
        "",
        "option 2",
        "```text",
        "There’s also a hiring signal buried in this\necosystems that reward builders tend to produce more builders",
        "```",
        "",
        "option 3",
        "```text",
        "The compounding point is the killer\nin anything model or workflow driven, every week matters",
        "```"
    ].join("\n"));
});

test("extractAssistantTurnText synthesizes options from rendered text blocks when ChatGPT does not expose pre/code nodes", () => {
    const renderedBlocks = [
        { innerText: "option 1" },
        { innerText: "The posture point is the real one\nsame models, same APIs, same internet, completely different default behavior" },
        { innerText: "option 2" },
        { innerText: "This is blunt, but mostly true\ni’ve seen teams lose months polishing governance before they had usage worth governing" }
    ];
    const turn = {
        innerText: "",
        textContent: "",
        querySelectorAll(selector) {
            if (selector === '[dir="auto"]' || selector === ".whitespace-pre-wrap" || selector === "p" || selector === "li" || selector === '[data-message-author-role="assistant"] [dir="auto"]') {
                return renderedBlocks;
            }
            return [];
        }
    };

    assert.equal(extractAssistantTurnText(turn), [
        "option 1",
        "```text",
        "The posture point is the real one\nsame models, same APIs, same internet, completely different default behavior",
        "```",
        "",
        "option 2",
        "```text",
        "This is blunt, but mostly true\ni’ve seen teams lose months polishing governance before they had usage worth governing",
        "```"
    ].join("\n"));
});

test("shared ChatGPT extraction helper exposes page-level response recovery", () => {
    const documentLike = {
        body: {
            innerText: [
                "option 1",
                "The posture point is the real one",
                "",
                "option 2",
                "This is blunt, but mostly true"
            ].join("\n")
        }
    };

    assert.equal(typeof extractDocumentResponseText, "function");
    assert.equal(
        extractDocumentResponseText(documentLike),
        documentLike.body.innerText
    );
});

test("shouldAcceptPrimaryExtractionCandidate accepts meaningful assistant prose without option labels", () => {
    const text = [
        "The strongest part of this post is that it names the posture shift directly.",
        "That makes the point feel earned instead of generic."
    ].join("\n");

    assert.equal(shouldAcceptPrimaryExtractionCandidate({
        text,
        isAssistantTurn: true
    }), true);
});

test("extractDocumentResponseText recovers meaningful page text without requiring option markers", () => {
    const documentLike = {
        body: {
            innerText: [
                "The strongest part of this post is that it names the posture shift directly.",
                "",
                "That makes the point feel earned instead of generic."
            ].join("\n")
        }
    };

    assert.equal(
        extractDocumentResponseText(documentLike),
        documentLike.body.innerText
    );
});

test("extractAssistantTurnText falls back to visible text nodes when selectors miss rendered assistant text", () => {
    const allowedParent = {
        closest() {
            return null;
        },
        getAttribute(name) {
            return name === "aria-hidden" ? "false" : null;
        }
    };
    const buttonParent = {
        closest(selector) {
            return selector === "button, svg, nav, form, textarea, script, style" ? {} : null;
        },
        getAttribute() {
            return null;
        }
    };
    const treeNodes = [
        { nodeValue: "Copy", parentElement: buttonParent },
        { nodeValue: "The strongest part of this post is that it names the posture shift directly.", parentElement: allowedParent },
        { nodeValue: "That makes the point feel earned instead of generic.", parentElement: allowedParent }
    ];
    const turn = {
        innerText: "",
        textContent: "",
        ownerDocument: {
            createTreeWalker() {
                let index = -1;
                return {
                    nextNode() {
                        index += 1;
                        return treeNodes[index] || null;
                    }
                };
            }
        },
        querySelectorAll() {
            return [];
        }
    };

    global.NodeFilter = {
        SHOW_TEXT: 4,
        FILTER_ACCEPT: 1,
        FILTER_REJECT: 2
    };

    assert.equal(
        extractAssistantTurnText(turn),
        [
            "The strongest part of this post is that it names the posture shift directly.",
            "That makes the point feel earned instead of generic."
        ].join("\n")
    );
});

test("findLastAssistantTurn returns the newest assistant turn instead of scanning the whole document", () => {
    const olderAssistantTurn = {
        getAttribute(name) {
            return name === "data-message-author-role" ? "assistant" : null;
        },
        className: "turn-assistant",
        classList: {
            contains(className) {
                return className === "turn-assistant";
            }
        },
        closest() {
            return null;
        }
    };
    const userTurn = {
        getAttribute(name) {
            return name === "data-message-author-role" ? "user" : null;
        },
        className: "turn-user",
        classList: {
            contains() {
                return false;
            }
        },
        closest() {
            return null;
        }
    };
    const newestAssistantTurn = {
        getAttribute(name) {
            return name === "data-message-author-role" ? "assistant" : null;
        },
        className: "turn-assistant",
        classList: {
            contains(className) {
                return className === "turn-assistant";
            }
        },
        closest() {
            return null;
        }
    };
    const documentLike = {
        querySelectorAll(selector) {
            if (selector === '[data-message-author-role]') {
                return [olderAssistantTurn, userTurn, newestAssistantTurn];
            }

            if (selector === '.turn-assistant') {
                return [olderAssistantTurn, newestAssistantTurn];
            }

            return [];
        }
    };

    assert.equal(findLastAssistantTurn(documentLike), newestAssistantTurn);
});

test("extractAssistantTurnText prefers structured content inside the assistant turn before raw outer text", () => {
    const codeNodes = [
        { innerText: "First real option\nwith detail" },
        { innerText: "Second real option\nwith detail" }
    ];
    const turn = {
        innerText: [
            "Copy",
            "Share",
            "The raw turn text is noisy and should not win when code blocks exist."
        ].join("\n"),
        textContent: [
            "Copy",
            "Share",
            "The raw turn text is noisy and should not win when code blocks exist."
        ].join("\n"),
        querySelectorAll(selector) {
            if (selector === "pre code" || selector === "pre" || selector === "[data-testid*=\"code\"]" || selector === "code") {
                return codeNodes;
            }
            return [];
        }
    };

    assert.equal(extractAssistantTurnText(turn), [
        "option 1",
        "```text",
        "First real option\nwith detail",
        "```",
        "",
        "option 2",
        "```text",
        "Second real option\nwith detail",
        "```"
    ].join("\n"));
});
