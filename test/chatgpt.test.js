const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createFallbackChatGptExtraction,
    getVisibilityDiagnostics,
    waitForStableAssistantContent
} = require("../src/chatgpt.js");

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

test("createFallbackChatGptExtraction accepts meaningful assistant prose without option labels", () => {
    const extraction = createFallbackChatGptExtraction();
    const text = [
        "The strongest part of this post is that it names the posture shift directly.",
        "That makes the point feel earned instead of generic."
    ].join("\n");

    assert.equal(extraction.shouldAcceptPrimaryExtractionCandidate({
        text,
        isAssistantTurn: true
    }), true);
});

test("getVisibilityDiagnostics reports hidden popup state", () => {
    const documentLike = {
        visibilityState: "hidden",
        hidden: true,
        hasFocus() {
            return false;
        }
    };

    assert.deepEqual(getVisibilityDiagnostics(documentLike), {
        visibilityState: "hidden",
        hasFocus: false,
        hidden: true
    });
});

test("waitForStableAssistantContent waits until assistant text stabilizes across repeated checks", async () => {
    const snapshots = [
        "",
        "Searching",
        [
            "option 1",
            "```text",
            "A real comment appears here",
            "```"
        ].join("\n"),
        [
            "option 1",
            "```text",
            "A real comment appears here",
            "```"
        ].join("\n"),
        [
            "option 1",
            "```text",
            "A real comment appears here",
            "```"
        ].join("\n")
    ];
    let attempt = 0;
    let now = 0;
    const turn = {};

    const result = await waitForStableAssistantContent({
        documentLike: {
            visibilityState: "visible",
            hidden: false,
            hasFocus() {
                return true;
            }
        },
        extraction: {
            findLastAssistantTurn() {
                return turn;
            },
            extractAssistantTurnText() {
                const index = Math.min(attempt, snapshots.length - 1);
                const value = snapshots[index];
                attempt += 1;
                return value;
            }
        },
        sleepFn: async () => {},
        nowFn: () => {
            now += 100;
            return now;
        },
        timeoutMs: 800,
        hiddenExtraTimeoutMs: 0,
        pollIntervalMs: 1,
        stableSamplesRequired: 2
    });

    assert.equal(result.text, snapshots[2]);
    assert.equal(result.turn, turn);
    assert.equal(result.stableSamples >= 2, true);
});

test("waitForStableAssistantContent keeps retrying longer when the page is hidden", async () => {
    const snapshots = [
        "",
        "",
        "",
        [
            "option 1",
            "```text",
            "Hidden mode finally produced a stable answer",
            "```"
        ].join("\n"),
        [
            "option 1",
            "```text",
            "Hidden mode finally produced a stable answer",
            "```"
        ].join("\n"),
        [
            "option 1",
            "```text",
            "Hidden mode finally produced a stable answer",
            "```"
        ].join("\n")
    ];
    let attempt = 0;
    let now = 0;

    const result = await waitForStableAssistantContent({
        documentLike: {
            visibilityState: "hidden",
            hidden: true,
            hasFocus() {
                return false;
            }
        },
        extraction: {
            findLastAssistantTurn() {
                return {};
            },
            extractAssistantTurnText() {
                const index = Math.min(attempt, snapshots.length - 1);
                const value = snapshots[index];
                attempt += 1;
                return value;
            }
        },
        sleepFn: async () => {},
        nowFn: () => {
            now += 1000;
            return now;
        },
        timeoutMs: 2500,
        hiddenExtraTimeoutMs: 5000,
        pollIntervalMs: 1,
        stableSamplesRequired: 2
    });

    assert.equal(
        result.text,
        [
            "option 1",
            "```text",
            "Hidden mode finally produced a stable answer",
            "```"
        ].join("\n")
    );
    assert.equal(attempt >= 5, true);
});
