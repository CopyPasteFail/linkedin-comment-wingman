const test = require("node:test");
const assert = require("node:assert/strict");

const { resolvePostContainer } = require("../src/linkedin-post-context.js");

function createNode({
    parentElement = null,
    tagName = "DIV",
    matchesSelectors = [],
    label = ""
} = {}) {
    return {
        parentElement,
        tagName,
        label,
        matches(selector) {
            return matchesSelectors.includes(selector);
        }
    };
}

test("resolvePostContainer returns the nearest recognized feed post", () => {
    const post = createNode({
        tagName: "ARTICLE",
        matchesSelectors: [".occludable-update", "article"],
        label: "post"
    });
    const actionBar = createNode({ parentElement: post, label: "actionBar" });
    const button = createNode({ parentElement: actionBar, label: "button" });

    assert.equal(resolvePostContainer(button, actionBar, {}), post);
});

test("resolvePostContainer returns null for non-post chrome like the top navigation bar", () => {
    const header = createNode({ tagName: "HEADER", label: "header" });
    const navRow = createNode({ parentElement: header, label: "navRow" });
    const button = createNode({ parentElement: navRow, label: "button" });

    assert.equal(resolvePostContainer(button, navRow, {}), null);
});
