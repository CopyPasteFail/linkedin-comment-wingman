const test = require("node:test");
const assert = require("node:assert/strict");

const { parseGeneratedOptions } = require("../src/linkedin-results.js");

test("parseGeneratedOptions strips a standalone text fence marker from fallback parsing", () => {
    const response = [
        "option 1",
        "```",
        "text",
        "first useful comment",
        "```",
        "",
        "option 2",
        "```",
        "text",
        "second useful comment",
        "```"
    ].join("\n");

    assert.deepEqual(parseGeneratedOptions(response), [
        "first useful comment",
        "second useful comment"
    ]);
});

test("parseGeneratedOptions keeps multiline comments when trimming prompt noise", () => {
    const response = [
        "# Role",
        "prompt noise",
        "",
        "option 1",
        "```text",
        "line one",
        "line two",
        "```"
    ].join("\n");

    assert.deepEqual(parseGeneratedOptions(response), ["line one\nline two"]);
});

test("parseGeneratedOptions ignores prompt template placeholders when the extracted transcript also contains the real reply", () => {
    const response = [
        "# Output format",
        "option 1",
        "```text",
        "<comment>",
        "```",
        "",
        "option 2",
        "```text",
        "<comment>",
        "```",
        "",
        "Thought for a couple of seconds",
        "",
        "option 1",
        "```text",
        "This is blunt, but mostly right",
        "same tools, same APIs, very different default behavior",
        "```",
        "",
        "option 2",
        "```text",
        "The difference is posture",
        "in practice that mindset compounds fast",
        "```"
    ].join("\n");

    assert.deepEqual(parseGeneratedOptions(response), [
        "This is blunt, but mostly right\nsame tools, same APIs, very different default behavior",
        "The difference is posture\nin practice that mindset compounds fast"
    ]);
});

test("parseGeneratedOptions rejects prompt template output when no real comments were extracted", () => {
    const response = [
        "option 1",
        "```text",
        "<comment>",
        "```",
        "",
        "option 2",
        "```text",
        "<comment>",
        "```",
        "",
        "...and so on up to option 8.",
        "ONLY return the options.",
        "",
        "Formatting rules:",
        "- label outside code block",
        "- only the comment inside",
        "- preserve line breaks",
        "- no extra text"
    ].join("\n");

    assert.deepEqual(parseGeneratedOptions(response), [
        "Error: Could not extract comments. Please check the ChatGPT popup window."
    ]);
});
