const test = require("node:test");
const assert = require("node:assert/strict");

const {
    isLikelyCommentButton
} = require("../src/linkedin-injection.js");

test("isLikelyCommentButton matches explicit comment labels", () => {
    assert.equal(isLikelyCommentButton({
        ariaLabel: "Comment",
        textContent: "",
        buttonIndex: 0,
        actionButtonCount: 4,
        hasCommentComposer: false,
        withinPostContainer: false
    }), true);
});

test("isLikelyCommentButton falls back to the second icon-only action button on a post detail page", () => {
    assert.equal(isLikelyCommentButton({
        ariaLabel: "",
        textContent: "",
        buttonIndex: 1,
        actionButtonCount: 4,
        hasCommentComposer: true,
        withinPostContainer: true
    }), true);
});

test("isLikelyCommentButton does not match other icon-only buttons in the action row", () => {
    assert.equal(isLikelyCommentButton({
        ariaLabel: "",
        textContent: "",
        buttonIndex: 0,
        actionButtonCount: 4,
        hasCommentComposer: true,
        withinPostContainer: true
    }), false);
});

test("isLikelyCommentButton does not use the structural fallback outside a feed post", () => {
    assert.equal(isLikelyCommentButton({
        ariaLabel: "",
        textContent: "",
        buttonIndex: 1,
        actionButtonCount: 4,
        hasCommentComposer: true,
        withinPostContainer: false
    }), false);
});
