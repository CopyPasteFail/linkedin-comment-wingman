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
