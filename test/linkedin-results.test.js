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
