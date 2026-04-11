const test = require("node:test");
const assert = require("node:assert/strict");

const runtimeGuards = require("../src/runtime-guards");

test("safeSendRuntimeMessage captures extension context invalidation errors", () => {
    const runtime = {
        id: "wingman",
        sendMessage() {
            throw new Error("Extension context invalidated.");
        }
    };

    const result = runtimeGuards.safeSendRuntimeMessage(runtime, { action: "ping" });

    assert.equal(result.ok, false);
    assert.equal(result.error.message, "Extension context invalidated.");
    assert.equal(runtimeGuards.isExtensionContextInvalidated(result.error), true);
});

test("safeSendRuntimeMessage reports a missing runtime as unavailable", () => {
    const result = runtimeGuards.safeSendRuntimeMessage(null, { action: "ping" });

    assert.equal(result.ok, false);
    assert.match(result.error.message, /extension runtime is unavailable/i);
});

test("isRuntimeAvailable reports false when the extension runtime id is missing", () => {
    assert.equal(runtimeGuards.isRuntimeAvailable({ sendMessage() {} }), false);
    assert.equal(runtimeGuards.isRuntimeAvailable({ id: "", sendMessage() {} }), false);
});

test("isRuntimeAvailable reports true when runtime id and messaging are present", () => {
    assert.equal(runtimeGuards.isRuntimeAvailable({ id: "wingman", sendMessage() {} }), true);
});
