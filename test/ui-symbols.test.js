const test = require("node:test");
const assert = require("node:assert/strict");

const uiSymbols = require("../src/ui-symbols");

test("ui symbols expose the default button glyphs", () => {
    assert.equal(uiSymbols.WINGMAN_IDLE_SYMBOL, "✨");
    assert.equal(uiSymbols.WINGMAN_LOADING_SYMBOL, "⏳");
});
