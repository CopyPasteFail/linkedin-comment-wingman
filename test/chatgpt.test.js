const test = require("node:test");
const assert = require("node:assert/strict");

const { createFallbackChatGptExtraction } = require("../src/chatgpt.js");

test("createFallbackChatGptExtraction can recover rendered option blocks without external helper state", () => {
    const extraction = createFallbackChatGptExtraction();
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

    assert.equal(extraction.extractAssistantTurnText(turn), [
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

test("createFallbackChatGptExtraction can fall back to visible page text when turn-level extraction misses the response", () => {
    const extraction = createFallbackChatGptExtraction();
    const documentLike = {
        body: {
            innerText: [
                "Europe doesn't need more rules. It needs more builders.",
                "",
                "Thought for a couple of seconds",
                "",
                "option 1",
                "The posture point is the real one",
                "same models, same APIs, same internet, completely different default behavior",
                "",
                "option 2",
                "This is blunt, but mostly true",
                "i’ve seen teams lose months polishing governance before they had usage worth governing"
            ].join("\n")
        }
    };

    assert.equal(
        extraction.extractDocumentResponseText(documentLike),
        documentLike.body.innerText
    );
});
