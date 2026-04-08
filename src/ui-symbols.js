/* global module */

const wingmanUiSymbols = {
    WINGMAN_IDLE_SYMBOL: "✨",
    WINGMAN_LOADING_SYMBOL: "⏳"
};

if (typeof globalThis !== "undefined") {
    globalThis.WingmanUiSymbols = wingmanUiSymbols;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = wingmanUiSymbols;
}
