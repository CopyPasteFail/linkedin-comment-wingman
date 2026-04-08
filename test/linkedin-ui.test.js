const test = require("node:test");
const assert = require("node:assert/strict");

const {
    getCompanionLayout,
    getNextActivePostId
} = require("../src/linkedin-ui.js");

test("getNextActivePostId closes the current panel when the same post is clicked again", () => {
    assert.equal(getNextActivePostId("wingman-post-1", "wingman-post-1"), null);
});

test("getNextActivePostId switches to a different post when another Wingman button is clicked", () => {
    assert.equal(getNextActivePostId("wingman-post-1", "wingman-post-2"), "wingman-post-2");
});

test("getCompanionLayout uses the side companion layout when there is enough room beside the post", () => {
    const layout = getCompanionLayout({
        viewportWidth: 1400,
        viewportHeight: 900,
        postRect: {
            top: 140,
            right: 860
        }
    });

    assert.equal(layout.mode, "side");
    assert.equal(layout.left, 884);
    assert.equal(layout.width, 380);
    assert.equal(layout.top, 140);
    assert.equal(layout.maxHeight, 744);
});

test("getCompanionLayout falls back inline when the viewport is too narrow for a side panel", () => {
    const layout = getCompanionLayout({
        viewportWidth: 1080,
        viewportHeight: 900,
        postRect: {
            top: 140,
            right: 760
        }
    });

    assert.deepEqual(layout, { mode: "inline" });
});

test("getCompanionLayout falls back inline when there is not enough room to the right of the post", () => {
    const layout = getCompanionLayout({
        viewportWidth: 1320,
        viewportHeight: 900,
        postRect: {
            top: 140,
            right: 1004
        }
    });

    assert.deepEqual(layout, { mode: "inline" });
});
