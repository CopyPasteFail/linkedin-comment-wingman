const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createLinkedInScriptContext() {
    const documentListeners = new Map();
    const windowListeners = new Map();
    const runtimeListeners = [];

    class FakeMutationObserver {
        constructor(callback) {
            this.callback = callback;
        }

        observe() {}
        disconnect() {}
    }

    const document = {
        body: {},
        querySelectorAll() {
            return [];
        },
        querySelector() {
            return null;
        },
        addEventListener(eventName, listener) {
            documentListeners.set(eventName, listener);
        },
        removeEventListener(eventName) {
            documentListeners.delete(eventName);
        },
        getElementById() {
            return null;
        },
        createElement() {
            return {
                className: "",
                dataset: {},
                style: {},
                appendChild() {},
                addEventListener() {},
                classList: {
                    add() {},
                    remove() {},
                    toggle() {}
                }
            };
        }
    };

    const context = {
        console: {
            log() {},
            warn() {},
            error() {}
        },
        WeakSet,
        Map,
        setInterval() {
            return 1;
        },
        clearInterval() {},
        setTimeout(callback) {
            callback();
            return 1;
        },
        clearTimeout() {},
        MutationObserver: FakeMutationObserver,
        alert() {},
        navigator: {
            clipboard: {
                writeText() {
                    return Promise.resolve();
                }
            }
        },
        chrome: {
            runtime: {
                lastError: null,
                onMessage: {
                    addListener(listener) {
                        runtimeListeners.push(listener);
                    }
                },
                sendMessage(_message, callback) {
                    if (callback) {
                        callback({ status: "started" });
                    }
                }
            }
        },
        window: {
            innerWidth: 1400,
            innerHeight: 900,
            addEventListener(eventName, listener) {
                windowListeners.set(eventName, listener);
            },
            removeEventListener(eventName) {
                windowListeners.delete(eventName);
            },
            requestAnimationFrame(callback) {
                callback();
                return 1;
            },
            cancelAnimationFrame() {},
            setTimeout(callback) {
                callback();
                return 1;
            }
        },
        document
    };

    context.globalThis = context;

    return {
        context,
        runtimeListeners
    };
}

test("linkedin content script can be evaluated twice without redeclaration errors or duplicate listeners", () => {
    const scriptPath = path.join(__dirname, "..", "src", "linkedin.js");
    const scriptSource = fs.readFileSync(scriptPath, "utf8");
    const { context, runtimeListeners } = createLinkedInScriptContext();

    vm.runInNewContext(scriptSource, context, { filename: "src/linkedin.js" });
    assert.equal(runtimeListeners.length, 1);

    assert.doesNotThrow(() => {
        vm.runInNewContext(scriptSource, context, { filename: "src/linkedin.js" });
    });
    assert.equal(runtimeListeners.length, 1);
});

test("linkedin content helpers include role buttons and links in interactive control discovery", () => {
    const scriptPath = path.join(__dirname, "..", "src", "linkedin.js");
    const scriptSource = fs.readFileSync(scriptPath, "utf8");
    const { context } = createLinkedInScriptContext();

    vm.runInNewContext(scriptSource, context, { filename: "src/linkedin.js" });

    const controls = [
        {
            classList: {
                contains(className) {
                    return className === "wingman-btn";
                }
            }
        },
        {
            classList: {
                contains() {
                    return false;
                }
            },
            tagName: "BUTTON"
        },
        {
            classList: {
                contains() {
                    return false;
                }
            },
            tagName: "DIV",
            getAttribute(name) {
                return name === "role" ? "button" : null;
            }
        },
        {
            classList: {
                contains() {
                    return false;
                }
            },
            tagName: "A"
        }
    ];

    const root = {
        querySelectorAll(selector) {
            assert.equal(selector, "button, [role='button'], a");
            return controls;
        }
    };

    assert.equal(
        context.WingmanLinkedInContentInternals.getInteractiveControls(root).length,
        3
    );
});

test("linkedin content helpers recognize a feed social row even when comment is not directly detectable", () => {
    const scriptPath = path.join(__dirname, "..", "src", "linkedin.js");
    const scriptSource = fs.readFileSync(scriptPath, "utf8");
    const { context } = createLinkedInScriptContext();

    vm.runInNewContext(scriptSource, context, { filename: "src/linkedin.js" });

    const actionBar = {
        querySelectorAll() {
            return [
                {
                    innerText: "Like",
                    textContent: "Like",
                    getAttribute(name) {
                        return name === "aria-label" ? "Reaction button state" : null;
                    },
                    classList: { contains() { return false; } }
                },
                {
                    innerText: "Open reactions menu",
                    textContent: "Open reactions menu",
                    getAttribute(name) {
                        return name === "aria-label" ? "Open reactions menu" : null;
                    },
                    classList: { contains() { return false; } }
                },
                {
                    innerText: "",
                    textContent: "",
                    getAttribute(name) {
                        return name === "aria-label" ? "" : null;
                    },
                    classList: { contains() { return false; } }
                },
                {
                    innerText: "Repost",
                    textContent: "Repost",
                    getAttribute(name) {
                        return name === "aria-label" ? "Repost" : null;
                    },
                    classList: { contains() { return false; } }
                }
            ];
        }
    };

    assert.equal(
        context.WingmanLinkedInContentInternals.isLikelyPostSocialActionBar(actionBar, {}),
        true
    );
});

test("linkedin content helpers score footer candidates from reaction anchors near the bottom of a post", () => {
    const scriptPath = path.join(__dirname, "..", "src", "linkedin.js");
    const scriptSource = fs.readFileSync(scriptPath, "utf8");
    const { context } = createLinkedInScriptContext();

    vm.runInNewContext(scriptSource, context, { filename: "src/linkedin.js" });

    const postRect = { top: 100, bottom: 500, height: 400 };
    const postContainer = {
        getBoundingClientRect() {
            return postRect;
        }
    };

    const footerControls = [
        {
            innerText: "Like",
            textContent: "Like",
            getAttribute(name) {
                return name === "aria-label" ? "Reaction button state" : null;
            },
            classList: { contains() { return false; } }
        },
        {
            innerText: "",
            textContent: "",
            getAttribute() {
                return "";
            },
            classList: { contains() { return false; } }
        },
        {
            innerText: "Repost",
            textContent: "Repost",
            getAttribute(name) {
                return name === "aria-label" ? "Repost" : null;
            },
            classList: { contains() { return false; } }
        }
    ];

    const candidate = {
        querySelectorAll() {
            return footerControls;
        },
        getBoundingClientRect() {
            return { top: 410, bottom: 470, height: 60 };
        }
    };

    const scored = context.WingmanLinkedInContentInternals.scoreFooterCandidate(candidate, postContainer);

    assert.equal(scored.score >= 8, true);
    assert.equal(scored.controlCount, 3);
    assert.equal(scored.tokens.includes("reaction"), true);
    assert.equal(scored.tokens.includes("repost"), true);
});

test("linkedin content helpers find a footer candidate from a reaction anchor when the row has many controls", () => {
    const scriptPath = path.join(__dirname, "..", "src", "linkedin.js");
    const scriptSource = fs.readFileSync(scriptPath, "utf8");
    const { context } = createLinkedInScriptContext();

    vm.runInNewContext(scriptSource, context, { filename: "src/linkedin.js" });

    const footer = {
        parentElement: null,
        querySelectorAll(selector) {
            if (selector === "button, [role='button'], a") {
                return new Array(7).fill(null).map((_, index) => ({
                    innerText: index === 0 ? "Like" : index === 4 ? "Repost" : `Control ${index}`,
                    textContent: index === 0 ? "Like" : index === 4 ? "Repost" : `Control ${index}`,
                    getAttribute(name) {
                        if (name !== "aria-label") {
                            return null;
                        }

                        if (index === 0) {
                            return "Reaction button state";
                        }

                        if (index === 4) {
                            return "Repost";
                        }

                        return "";
                    },
                    classList: { contains() { return false; } }
                }));
            }

            return [];
        },
        getBoundingClientRect() {
            return { top: 420, bottom: 485, height: 65 };
        }
    };

    const reactionControl = {
        innerText: "Like",
        textContent: "Like",
        parentElement: footer,
        getAttribute(name) {
            return name === "aria-label" ? "Reaction button state" : null;
        },
        classList: { contains() { return false; } }
    };

    const postContainer = {
        querySelectorAll(selector) {
            if (selector === "button, [role='button'], a") {
                return [reactionControl];
            }
            return [];
        },
        getBoundingClientRect() {
            return { top: 100, bottom: 500, height: 400 };
        },
        contains(node) {
            return node === reactionControl || node === footer;
        }
    };

    const found = context.WingmanLinkedInContentInternals.findBestFooterCandidate(postContainer);
    assert.equal(found.actionBar, footer);
    assert.equal(found.score.score > 0, true);
});

test("linkedin content helpers tolerate missing reaction metadata without throwing", () => {
    const scriptPath = path.join(__dirname, "..", "src", "linkedin.js");
    const scriptSource = fs.readFileSync(scriptPath, "utf8");
    const { context } = createLinkedInScriptContext();

    vm.runInNewContext(scriptSource, context, { filename: "src/linkedin.js" });

    assert.doesNotThrow(() => {
        context.WingmanLinkedInContentInternals.looksLikeReactionControl({
            text: undefined,
            aria: undefined,
            className: { baseVal: "svg-class" }
        });
    });
});

test("linkedin content helpers detect reaction controls when className is object-like but class attribute is present", () => {
    const scriptPath = path.join(__dirname, "..", "src", "linkedin.js");
    const scriptSource = fs.readFileSync(scriptPath, "utf8");
    const { context } = createLinkedInScriptContext();

    vm.runInNewContext(scriptSource, context, { filename: "src/linkedin.js" });

    assert.equal(
        context.WingmanLinkedInContentInternals.looksLikeReactionControl({
            innerText: undefined,
            textContent: undefined,
            className: { baseVal: "feed-shared-social-action-bar__reaction-button" },
            getAttribute(name) {
                if (name === "aria-label") {
                    return undefined;
                }

                if (name === "class") {
                    return "feed-shared-social-action-bar__reaction-button";
                }

                return undefined;
            }
        }),
        true
    );
});

test("linkedin content helpers do not emit reaction probe debug logs during matching", () => {
    const scriptPath = path.join(__dirname, "..", "src", "linkedin.js");
    const scriptSource = fs.readFileSync(scriptPath, "utf8");
    const { context } = createLinkedInScriptContext();
    const logs = [];

    context.console.log = (...args) => {
        logs.push(args);
    };

    vm.runInNewContext(scriptSource, context, { filename: "src/linkedin.js" });

    context.WingmanLinkedInContentInternals.looksLikeReactionControl({
        innerText: "Like",
        textContent: "Like",
        className: "",
        getAttribute(name) {
            return name === "aria-label" ? "Reaction button state" : undefined;
        }
    });

    assert.equal(
        logs.some(([message]) => message === "Wingman reaction probe"),
        false
    );
});

test("linkedin content helpers keep collecting post containers when some controls have undefined fields", () => {
    const scriptPath = path.join(__dirname, "..", "src", "linkedin.js");
    const scriptSource = fs.readFileSync(scriptPath, "utf8");
    const { context } = createLinkedInScriptContext();

    const validRoot = {
        tagName: "DIV",
        className: "feed-card",
        innerText: "Author text Like Repost",
        textContent: "Author text Like Repost",
        querySelector() {
            return null;
        },
        querySelectorAll(selector) {
            if (selector === "button, [role='button'], a") {
                return [
                    malformedControl,
                    reactionControl
                ];
            }
            if (selector === '[aria-label*="Open control menu for post by" i]') {
                return [menuControl];
            }
            return [];
        }
    };
    const malformedControl = {
        parentElement: validRoot,
        innerText: undefined,
        textContent: undefined,
        className: { baseVal: "icon" },
        getAttribute() {
            return undefined;
        },
        classList: { contains() { return false; } }
    };
    const reactionControl = {
        parentElement: validRoot,
        innerText: undefined,
        textContent: undefined,
        className: null,
        getAttribute(name) {
            return name === "aria-label" ? "Reaction button state" : undefined;
        },
        classList: { contains() { return false; } }
    };
    const menuControl = {
        parentElement: validRoot,
        getAttribute(name) {
            return name === "aria-label" ? "Open control menu for post by Someone" : undefined;
        }
    };

    context.document.body = {};
    context.document.querySelectorAll = (selector) => {
        if (selector === "button, [role='button'], a") {
            return [malformedControl, reactionControl];
        }
        if (selector === '[aria-label*="Open control menu for post by" i]') {
            return [menuControl];
        }
        if (selector === "article, div, section, main, li") {
            return [validRoot];
        }
        return [];
    };
    context.WingmanLinkedInPostContext = {
        collectLikelyPostRoots() {
            return [validRoot];
        }
    };

    vm.runInNewContext(scriptSource, context, { filename: "src/linkedin.js" });

    assert.doesNotThrow(() => {
        const roots = context.WingmanLinkedInContentInternals.collectPostContainers();
        assert.equal(roots.length, 1);
    });
});
