const test = require("node:test");
const assert = require("node:assert/strict");

const {
    collectLikelyPostRoots,
    resolvePostContainer
} = require("../src/linkedin-post-context.js");

function createNode({
    attrs = {},
    parentElement = null,
    tagName = "DIV",
    matchesSelectors = [],
    label = "",
    innerText = "",
    textContent = ""
} = {}) {
    return {
        attrs,
        parentElement,
        tagName,
        label,
        innerText,
        textContent,
        getAttribute(name) {
            return attrs[name] || null;
        },
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

test("resolvePostContainer can recover a feed card from a reaction anchor even without legacy post classes", () => {
    const feedCard = createNode({
        tagName: "DIV",
        label: "feedCard"
    });
    const body = {};
    const wrapper = createNode({ parentElement: feedCard, label: "wrapper" });
    const reaction = createNode({
        parentElement: wrapper,
        label: "reaction",
        innerText: "Like",
        textContent: "Like",
        attrs: {
            "aria-label": "Reaction button state"
        }
    });

    feedCard.querySelectorAll = (selector) => {
        if (selector === "button, [role='button'], a") {
            return [reaction];
        }
        if (selector === '[aria-label*="Open control menu for post by" i]') {
            return [];
        }
        return [];
    };
    feedCard.contains = (node) => node === wrapper || node === reaction;
    feedCard.getBoundingClientRect = () => ({ top: 100, bottom: 500, height: 400 });
    wrapper.contains = (node) => node === reaction;

    assert.equal(resolvePostContainer(reaction, wrapper, body), feedCard);
});

test("collectLikelyPostRoots finds structural feed cards without classic post classes", () => {
    const body = {};
    const feedCard = createNode({
        tagName: "DIV",
        label: "feedCard",
        textContent: "Author Name Useful post text Like Comment Repost"
    });
    const reaction = createNode({
        parentElement: feedCard,
        label: "reaction",
        innerText: "Like",
        textContent: "Like",
        attrs: {
            "aria-label": "Reaction button state"
        }
    });
    const menu = createNode({
        parentElement: feedCard,
        label: "menu",
        attrs: {
            "aria-label": "Open control menu for post by Author Name"
        }
    });
    const comment = createNode({
        parentElement: feedCard,
        label: "comment",
        innerText: "Comment",
        textContent: "Comment"
    });

    feedCard.querySelectorAll = (selector) => {
        if (selector === "button, [role='button'], a") {
            return [reaction, comment];
        }
        if (selector === '[aria-label*="Open control menu for post by" i]') {
            return [menu];
        }
        return [];
    };
    feedCard.contains = (node) => [reaction, menu, comment].includes(node);
    feedCard.getBoundingClientRect = () => ({ top: 120, bottom: 540, height: 420 });

    const nav = createNode({
        tagName: "NAV",
        label: "nav",
        textContent: "Home My Network Jobs Messaging"
    });
    nav.querySelectorAll = () => [];
    nav.contains = () => false;
    nav.getBoundingClientRect = () => ({ top: 0, bottom: 80, height: 80 });

    const documentLike = {
        body,
        querySelectorAll(selector) {
            if (selector === "button, [role='button'], a") {
                return [reaction, comment];
            }
            if (selector === '[aria-label*="Open control menu for post by" i]') {
                return [menu];
            }
            if (selector === "article, div, section, main, li") {
                return [feedCard, nav];
            }
            return [];
        }
    };

    const roots = collectLikelyPostRoots(documentLike);
    assert.deepEqual(roots, [feedCard]);
});
