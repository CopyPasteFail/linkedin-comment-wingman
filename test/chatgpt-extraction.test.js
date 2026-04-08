const test = require("node:test");
const assert = require("node:assert/strict");

const {
    collectTurns,
    extractDocumentResponseText,
    extractAssistantTurnText,
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
