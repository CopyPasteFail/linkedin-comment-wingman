/* global module */

function createRuntimeUnavailableError() {
    return new Error("Wingman extension runtime is unavailable.");
}

function isRuntimeAvailable(runtime) {
    return Boolean(runtime?.id && typeof runtime?.sendMessage === "function");
}

function isExtensionContextInvalidated(error) {
    return Boolean(error?.message) && /extension context invalidated/i.test(error.message);
}

function safeSendRuntimeMessage(runtime, message, callback) {
    if (!isRuntimeAvailable(runtime)) {
        return { ok: false, error: createRuntimeUnavailableError() };
    }

    try {
        runtime.sendMessage(message, callback);
        return { ok: true };
    } catch (error) {
        return { ok: false, error };
    }
}

const wingmanRuntimeGuards = {
    createRuntimeUnavailableError,
    isRuntimeAvailable,
    isExtensionContextInvalidated,
    safeSendRuntimeMessage
};

if (typeof globalThis !== "undefined") {
    globalThis.WingmanRuntimeGuards = wingmanRuntimeGuards;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = wingmanRuntimeGuards;
}
