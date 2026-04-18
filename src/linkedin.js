(() => {
    if (globalThis.WingmanLinkedInContentScriptLoaded) {
        return;
    }

    globalThis.WingmanLinkedInContentScriptLoaded = true;

    let postIdCounter = 0;
    const processedButtons = new WeakSet();
    const runtimeGuards = globalThis.WingmanRuntimeGuards || {
        createRuntimeUnavailableError: () => new Error("Wingman extension runtime is unavailable."),
        isRuntimeAvailable: (runtime) => Boolean(runtime?.id && typeof runtime?.sendMessage === "function"),
        isExtensionContextInvalidated: (error) => Boolean(error?.message) && /extension context invalidated/i.test(error.message),
        safeSendRuntimeMessage: (runtime, message, callback) => {
            if (!runtime?.id || !runtime?.sendMessage) {
                return { ok: false, error: new Error("Wingman extension runtime is unavailable.") };
            }

            try {
                runtime.sendMessage(message, callback);
                return { ok: true };
            } catch (error) {
                return { ok: false, error };
            }
        }
    };
    const wingmanUiSymbols = globalThis.WingmanUiSymbols || {
        WINGMAN_IDLE_SYMBOL: "✨",
        WINGMAN_LOADING_SYMBOL: "⏳"
    };
    const wingmanUi = globalThis.WingmanLinkedInUi || {};
    const wingmanResults = globalThis.WingmanLinkedInResults || {};
    const wingmanInjection = globalThis.WingmanLinkedInInjection || {};
    const wingmanPostContext = globalThis.WingmanLinkedInPostContext || {};
    const getCompanionLayout = wingmanUi.getCompanionLayout || (() => ({ mode: "inline" }));
    const getNextActivePostId = wingmanUi.getNextActivePostId || ((currentPostId, clickedPostId) => (
        currentPostId === clickedPostId ? null : clickedPostId
    ));
    const parseGeneratedOptions = wingmanResults.parseGeneratedOptions || ((text) => [text]);
    const isLikelyCommentButton = wingmanInjection.isLikelyCommentButton || (() => false);
    const collectLikelyPostRoots = wingmanPostContext.collectLikelyPostRoots || (() => []);
    const activeWingmanState = {
        postId: null,
        postContainer: null,
        actionBar: null,
        button: null,
        resultsContainer: null,
        cleanupLayout: null
    };

    let pollingInterval = null;
    let extensionReloadNoticeShown = false;
    let extensionRefreshRequired = false;

    const WINGMAN_DEBUG = globalThis.WINGMAN_DEBUG === true;

    console.log("Wingman Extension: Content script loaded and running!");

    function toSafeLowerString(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
    }

    function getSafeClassName(control) {
    if (typeof control?.className === "string") {
        return control.className;
    }

    if (typeof control?.getAttribute === "function") {
        return typeof control.getAttribute("class") === "string"
            ? control.getAttribute("class")
            : "";
    }

    return "";
    }

    function getControlMetadata(controlLike) {
    return {
        text: toSafeLowerString(controlLike?.text ?? controlLike?.innerText ?? controlLike?.textContent),
        aria: toSafeLowerString(controlLike?.aria ?? controlLike?.getAttribute?.("aria-label")),
        className: toSafeLowerString(getSafeClassName(controlLike))
    };
    }

    function getInteractiveControls(root) {
    return Array.from(root?.querySelectorAll?.("button, [role='button'], a") || [])
        .filter((element) => !element.classList?.contains("wingman-btn"));
    }

    function getControlLabel(control) {
    return getControlMetadata(control);
    }

    function looksLikeReactionControl(controlLike) {
    const { text, aria, className } = getControlMetadata(controlLike);

    if (WINGMAN_DEBUG) {
        console.log("Wingman reaction probe", {
            text,
            aria,
            className
        });
    }

    return text === "like" ||
        text === "open reactions menu" ||
        aria.includes("reaction button state") ||
        aria.includes("like") ||
        aria.includes("open reactions menu") ||
        className.includes("reaction");
    }

    function looksLikeCommentControl({ text, aria }) {
    const metadata = getControlMetadata({ text, aria });
    return metadata.text === "comment" || metadata.aria.includes("comment");
    }

    function looksLikeRepostControl({ text, aria }) {
    const metadata = getControlMetadata({ text, aria });
    return metadata.text === "repost" || metadata.aria.includes("repost");
    }

    function looksLikeSendControl({ text, aria }) {
    const metadata = getControlMetadata({ text, aria });
    return metadata.text === "send" || metadata.aria.includes("send");
    }

    function looksLikeNoiseControl({ text, aria }) {
    const metadata = getControlMetadata({ text, aria });
    const combined = `${metadata.text} ${metadata.aria}`;
    return /dismiss|report this ad|hide or report this ad|load more|full screen|previous page|next page|document page|collapse|expand/i.test(combined);
    }

    function getDistanceFromPostBottom(node, postContainer) {
    const postRect = postContainer?.getBoundingClientRect?.();
    const nodeRect = node?.getBoundingClientRect?.();

    if (!postRect || !nodeRect) {
        return Number.POSITIVE_INFINITY;
    }

    return Math.max(0, postRect.bottom - nodeRect.bottom);
    }

    function scoreFooterCandidate(candidate, postContainer) {
    const controls = getInteractiveControls(candidate);
    const controlLabels = controls.map(getControlLabel);
    const controlCount = controlLabels.length;
    const distanceFromBottom = getDistanceFromPostBottom(candidate, postContainer);
    const postHeight = postContainer?.getBoundingClientRect?.().height || 0;
    const isNearBottom = Number.isFinite(distanceFromBottom) && (
        distanceFromBottom <= 120 ||
        (postHeight > 0 && distanceFromBottom <= postHeight * 0.4)
    );

    let score = 0;
    const tokens = [];

    if (controlCount < 3) {
        return { candidate, score: Number.NEGATIVE_INFINITY, controlCount, tokens, distanceFromBottom };
    }

    if (controlLabels.some(looksLikeReactionControl)) {
        score += 4;
        tokens.push("reaction");
    }

    if (controlLabels.some(looksLikeCommentControl)) {
        score += 3;
        tokens.push("comment");
    }

    if (controlLabels.some(looksLikeRepostControl)) {
        score += 2;
        tokens.push("repost");
    }

    if (controlLabels.some(looksLikeSendControl)) {
        score += 2;
        tokens.push("send");
    }

    if (isNearBottom) {
        score += 2;
        tokens.push("bottom");
    }

    if (controlLabels.some(looksLikeNoiseControl)) {
        score -= 4;
        tokens.push("noise");
    }

    if (controlCount > 6) {
        score -= Math.min(4, controlCount - 6);
        tokens.push("dense");
    }

    return {
        candidate,
        score,
        controlCount,
        tokens,
        distanceFromBottom
    };
    }

    function isLikelyPostSocialActionBar(actionBar, postContainer) {
    const scored = scoreFooterCandidate(actionBar, postContainer);
    return scored.score >= 6 &&
        scored.tokens.includes("reaction") &&
        !scored.tokens.includes("noise");
    }

    function collectAncestorCandidates(anchor, postContainer) {
    const candidates = [];
    let current = anchor?.parentElement || null;
    let depth = 0;

    while (current && current !== postContainer && depth < 8) {
        if (postContainer?.contains?.(current)) {
            candidates.push(current);
        }

        current = current.parentElement;
        depth++;
    }

    return candidates;
    }

    function collectLowerPostCandidates(postContainer) {
    const postRect = postContainer?.getBoundingClientRect?.();
    if (!postRect) {
        return [];
    }

    const thresholdTop = postRect.top + (postRect.height * 0.6);
    const lowerControls = getInteractiveControls(postContainer)
        .filter((control) => {
            const rect = control.getBoundingClientRect?.();
            return rect && rect.top >= thresholdTop;
        });
    const candidates = new Set();

    lowerControls.forEach((control) => {
        let current = control.parentElement;
        let depth = 0;

        while (current && current !== postContainer && depth < 6) {
            if (postContainer.contains?.(current)) {
                candidates.add(current);
            }
            current = current.parentElement;
            depth++;
        }
    });

    return Array.from(candidates);
    }

    function findBestFooterCandidate(postContainer) {
    if (!postContainer) {
        return null;
    }

    const reactionAnchors = getInteractiveControls(postContainer)
        .filter((control) => looksLikeReactionControl(getControlLabel(control)));
    const candidateSet = new Set();

    reactionAnchors.forEach((anchor) => {
        collectAncestorCandidates(anchor, postContainer).forEach((candidate) => candidateSet.add(candidate));
    });

    collectLowerPostCandidates(postContainer).forEach((candidate) => candidateSet.add(candidate));

    const scoredCandidates = Array.from(candidateSet)
        .map((candidate) => scoreFooterCandidate(candidate, postContainer))
        .filter((entry) => Number.isFinite(entry.score))
        .sort((a, b) => b.score - a.score || a.distanceFromBottom - b.distanceFromBottom);

    if (WINGMAN_DEBUG) {
        console.log("Wingman feed debug candidates", scoredCandidates.slice(0, 3).map((entry) => ({
            score: entry.score,
            controlCount: entry.controlCount,
            tokens: entry.tokens,
            distanceFromBottom: entry.distanceFromBottom
        })));
    }

    const best = scoredCandidates[0];
    if (!best || best.score < 6) {
        return null;
    }

    return {
        actionBar: best.candidate,
        score: best
    };
    }

    function collectPostContainers() {
    const discoveredRoots = collectLikelyPostRoots(document);

    if (WINGMAN_DEBUG) {
        console.log("Wingman feed debug post roots", discoveredRoots.slice(0, 10).map((root) => ({
            tagName: root?.tagName || null,
            className: root?.className || null,
            textPreview: (root?.innerText || root?.textContent || "").trim().slice(0, 160),
            hasReactionControl: getInteractiveControls(root).some(looksLikeReactionControl),
            hasPostMenu: Array.from(root?.querySelectorAll?.('[aria-label*="Open control menu for post by" i]') || []).length > 0,
            interactiveCount: getInteractiveControls(root).length
        })));
    }

    return discoveredRoots;
    }

    function handleRuntimeMessagingFailure(error, actionDescription) {
    console.error(`Wingman: ${actionDescription} failed:`, error?.message || error);
    clearActiveResults();

    if (runtimeGuards.isExtensionContextInvalidated(error) || !runtimeGuards.isRuntimeAvailable(chrome?.runtime)) {
        extensionRefreshRequired = true;
        markWingmanButtonsRefreshRequired();
        if (!extensionReloadNoticeShown) {
            extensionReloadNoticeShown = true;
            alert("Wingman was reloaded or updated. Refresh this LinkedIn tab and try again.");
        }
        return;
    }

    alert(`Wingman couldn't ${actionDescription}: ${error?.message || "Unknown error"}`);
    }

    function markWingmanButtonsRefreshRequired() {
    document.querySelectorAll(".wingman-btn").forEach((button) => {
        button.classList.remove("loading");
        button.classList.add("wingman-btn-stale");
        button.disabled = true;
        button.innerHTML = `${buildGlyphIconHtml("↻")} Refresh tab`;
        button.setAttribute("title", "Refresh this LinkedIn tab to reconnect Wingman.");
    });
    }

    function shouldBlockGenerationForRuntime(runtime) {
    return extensionRefreshRequired || !runtimeGuards.isRuntimeAvailable(runtime);
    }

    function getLogoUrl() {
    try {
        return chrome.runtime.getURL("assets/icon.svg");
    } catch (_e) {
        return "";
    }
    }

    function buildLogoIconHtml() {
    const url = getLogoUrl();
    return `<img class="wingman-btn-icon wingman-btn-logo" src="${url}" alt="" draggable="false">`;
    }

    function buildGlyphIconHtml(glyph) {
    return `<span class="wingman-btn-icon">${glyph}</span>`;
    }

    function detectActionBarMode(actionBar) {
    if (!actionBar) return "inline";
    const sibling = Array.from(actionBar.querySelectorAll("button, [role='button']"))
        .find((el) => !el.classList.contains("wingman-btn") &&
                      !el.classList.contains("wingman-btn-expand") &&
                      !el.classList.contains("wingman-instructions-go") &&
                      !el.classList.contains("wingman-instructions-cancel"));
    if (!sibling) return "inline";

    let textRect = null;
    try {
        const walker = document.createTreeWalker(sibling, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const text = (node.textContent || "").trim();
            if (text.length < 2) continue;
            const range = document.createRange();
            range.selectNode(node);
            const r = range.getBoundingClientRect();
            if (r && r.width > 1 && r.height > 1) { textRect = r; break; }
        }
    } catch (_e) { /* fall through */ }

    if (!textRect) return "icon-only";

    const iconEl = sibling.querySelector("svg, img");
    const iconRect = iconEl?.getBoundingClientRect?.();

    if (iconRect && iconRect.width > 0 && iconRect.height > 0) {
        // Text below the icon -> stacked. Otherwise inline.
        if (textRect.y >= iconRect.y + iconRect.height - 2) return "stacked";
        return "inline";
    }

    const rect = sibling.getBoundingClientRect?.();
    if (rect && rect.height > rect.width) return "stacked";
    return "inline";
    }

    function buildMainBtnHtml(mode, iconHtml) {
    if (mode === "icon-only") return iconHtml;
    return `${iconHtml}<span class="wingman-btn-label">Wingman</span>`;
    }

    function expandInstructions(split) {
    if (!split) return;
    split.classList.add("wingman-split-expanded");
    const instructions = split._wingmanInstructions;
    if (instructions) instructions.classList.add("wingman-instructions-open");
    const input = instructions?.querySelector(".wingman-instructions-input");
    if (input) {
        window.setTimeout(() => input.focus(), 0);
    }
    }

    function collapseInstructions(split) {
    if (!split) return;
    split.classList.remove("wingman-split-expanded");
    const instructions = split._wingmanInstructions;
    if (instructions) instructions.classList.remove("wingman-instructions-open");
    const input = instructions?.querySelector(".wingman-instructions-input");
    if (input) input.value = "";
    }

    function submitWithInstructions(btn, postContainer, actionBar, rawInstructions, split) {
    const instructions = (rawInstructions || "").trim();
    collapseInstructions(split);
    handleWingmanClick(btn, postContainer, actionBar, instructions);
    }

    function injectWingmanButtons() {
    const postContainers = collectPostContainers();

    postContainers.forEach((postContainer) => {
        if (!postContainer) return;

        if (!postContainer.id) {
            postContainer.id = "wingman-post-" + (++postIdCounter);
        }

        if (postContainer.querySelector(".wingman-btn")) return;

        const footerCandidate = findBestFooterCandidate(postContainer);
        const actionBar = footerCandidate?.actionBar || null;

        if (!actionBar) return;

        const actionButtons = getInteractiveControls(actionBar);
        const commentLikeButton = actionButtons.find((control, index) => {
            const label = getControlLabel(control);
            const hasCommentComposer = Boolean(
                postContainer?.querySelector(".comments-comment-box__form") ||
                postContainer?.querySelector(".comments-comment-texteditor") ||
                postContainer?.querySelector('[contenteditable="true"][role="textbox"]') ||
                postContainer?.querySelector('textarea[placeholder*="comment" i]')
            );

            return isLikelyCommentButton({
                ariaLabel: control.getAttribute?.("aria-label") || "",
                textContent: control.innerText || control.textContent || "",
                buttonIndex: index,
                actionButtonCount: actionButtons.length,
                hasCommentComposer,
                withinPostContainer: true
            }) || looksLikeCommentControl(label);
        }) || actionButtons[0];

        if (commentLikeButton) {
            processedButtons.add(commentLikeButton);
        }

        const mode = detectActionBarMode(actionBar);

        const split = document.createElement("span");
        split.className = "wingman-split";
        split.dataset.postId = postContainer.id;
        split.dataset.mode = mode;

        const wingmanBtn = document.createElement("button");
        wingmanBtn.className = "wingman-btn";
        wingmanBtn.dataset.postId = postContainer.id;
        wingmanBtn.dataset.mode = mode;
        wingmanBtn.setAttribute("aria-label", "Wingman");
        wingmanBtn.setAttribute("title", "Wingman — generate comments");
        wingmanBtn.innerHTML = buildMainBtnHtml(mode, buildLogoIconHtml());
        wingmanBtn.style.cssText = "display: inline-flex !important; visibility: visible !important; opacity: 1 !important;";
        wingmanBtn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            handleWingmanClick(wingmanBtn, postContainer, actionBar);
        });

        const expandBtn = document.createElement("button");
        expandBtn.className = "wingman-btn-expand";
        expandBtn.type = "button";
        expandBtn.title = "Add special instructions";
        expandBtn.setAttribute("aria-label", "Add special instructions");
        expandBtn.textContent = "✎";
        expandBtn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            expandInstructions(split);
        });

        const instructions = document.createElement("span");
        instructions.className = "wingman-instructions";

        const input = document.createElement("input");
        input.type = "text";
        input.className = "wingman-instructions-input";
        input.placeholder = "e.g. use technology humor";
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                submitWithInstructions(wingmanBtn, postContainer, actionBar, input.value, split);
            } else if (event.key === "Escape") {
                event.preventDefault();
                collapseInstructions(split);
            }
        });

        const goBtn = document.createElement("button");
        goBtn.className = "wingman-instructions-go";
        goBtn.type = "button";
        goBtn.innerHTML = `${buildLogoIconHtml()} Go`;
        goBtn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            submitWithInstructions(wingmanBtn, postContainer, actionBar, input.value, split);
        });

        const cancelBtn = document.createElement("button");
        cancelBtn.className = "wingman-instructions-cancel";
        cancelBtn.type = "button";
        cancelBtn.title = "Cancel";
        cancelBtn.setAttribute("aria-label", "Cancel special instructions");
        cancelBtn.textContent = "×";
        cancelBtn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            collapseInstructions(split);
        });

        instructions.appendChild(input);
        instructions.appendChild(goBtn);
        instructions.appendChild(cancelBtn);

        split.appendChild(wingmanBtn);
        split.appendChild(expandBtn);
        split._wingmanInstructions = instructions;

        try {
            actionBar.appendChild(split);
            if (window.getComputedStyle(actionBar).position === "static") {
                actionBar.style.position = "relative";
            }
            actionBar.appendChild(instructions);
            syncWingmanButtonStates();
        } catch (error) {
            console.error("Wingman: Error appending button:", error);
        }
    });
    }

    function extractPostText(postContainer) {
    const contentSelectors = [
        ".update-components-text",
        ".feed-shared-update-v2__description",
        ".feed-shared-inline-show-more-text",
        ".update-components-text--core",
        ".feed-shared-annotated-text",
        ".feed-shared-article__description",
        '[data-test-id="main-feed-activity-card__commentary"]'
    ];

    for (const selector of contentSelectors) {
        const element = postContainer.querySelector(selector);
        if (element && element.textContent.trim().length > 10) {
            return cleanExtractedPostText(getFullElementText(element));
        }
    }

    const clone = postContainer.cloneNode(true);
    const noiseSelectors = [
        ".feed-shared-update-v2__social-row",
        ".feed-shared-social-action-bar",
        ".update-v2-social-activity",
        ".comment-social-bar",
        ".social-details-social-counts",
        ".social-details-social-activity-counts",
        ".social-details-social-activity",
        ".social-details-reactors-facepile",
        ".feed-shared-social-counts-bar",
        ".feed-shared-social-action-bar__action-button",
        ".social-actions-button",
        '[data-test-id*="social-actions"]',
        '[data-test-id*="social-counts"]',
        // video player
        "video",
        "[class*='vjs-']",
        "[class*='video-js']",
        "[class*='video-player']",
        "[class*='artdeco-video']",
        "[class*='media-player']",
        ".wingman-btn",
        ".wingman-results-container",
        "button",
        "footer"
    ];

    noiseSelectors.forEach((selector) => {
        clone.querySelectorAll(selector).forEach((element) => element.remove());
    });

    clone.querySelectorAll('[aria-hidden="true"]').forEach((element) => element.remove());

    const text = getFullElementText(clone);
    return cleanExtractedPostText(text).slice(0, 4000);
    }

    function getFullElementText(element) {
        if (!element) return "";
        return (element.textContent || element.innerText || "").replace(/\u00a0/g, " ");
    }

    function cleanExtractedPostText(raw) {
        if (!raw) return "";
        return raw
            .replace(/…\s*(see more|more)\b/gi, "")
            .replace(/\.{3}\s*(see more|more)\b/gi, "")
            // strip video player UI text that leaks through DOM removal
            .replace(/Video Player is loading\..*?(Send|$)/si, "")
            .replace(/Current Time\s+[\d:]+.*?(Send|$)/si, "")
            // strip trailing social counts: only match when ends with "Send" (LinkedIn share btn)
            // or when the social row was concatenated (word-digit run, e.g., "reactions2166")
            .replace(/\s*\d[\d,]*\s*(reaction|comment|repost)s?[^\n]*?Send\s*$/i, "")
            .replace(/\s*(reactions|comments|reposts)\d[\d,]*[^\n]*$/i, "")
            .replace(/\n[^\n]*\band \d+ others? reacted[^\n]*$/i, "")
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }

    function handleWingmanClick(btn, postContainer, actionBar, specialInstructions) {
    const nextActivePostId = getNextActivePostId(activeWingmanState.postId, postContainer.id);
    if (!nextActivePostId) {
        clearActiveResults();
        return;
    }

    const postText = extractPostText(postContainer);
    if (!postText.trim()) {
        alert("Wingman: Couldn't extract text from this post.");
        return;
    }

    const cleanInstructions = (specialInstructions || "").trim();

    console.log("Wingman: Starting generation for post", {
        postId: postContainer.id,
        textLength: postText.length,
        textPreview: postText.slice(0, 180),
        hasSpecialInstructions: Boolean(cleanInstructions)
    });

    if (shouldBlockGenerationForRuntime(chrome?.runtime)) {
        handleRuntimeMessagingFailure(
            runtimeGuards.createRuntimeUnavailableError(),
            "open ChatGPT"
        );
        return;
    }

    clearActiveResults();
    setActivePost(postContainer, actionBar, btn);

    btn.classList.add("loading");
    btn.innerHTML = buildMainBtnHtml(btn.dataset.mode || "inline", buildGlyphIconHtml(wingmanUiSymbols.WINGMAN_LOADING_SYMBOL));

    let generationStarted = false;
    const sendResult = runtimeGuards.safeSendRuntimeMessage(chrome.runtime, {
        action: "generate_comments",
        postText,
        specialInstructions: cleanInstructions,
        targetNodeId: postContainer.id
    }, (response) => {
        if (chrome.runtime.lastError) {
            handleRuntimeMessagingFailure(new Error(chrome.runtime.lastError.message), "open ChatGPT");
            return;
        }

        if (!response || response.status !== "started") {
            const errorMessage = response?.error || "ChatGPT popup did not start correctly.";
            console.error("Wingman: generate_comments returned an error:", errorMessage);
            clearActiveResults();
            alert(`Wingman couldn't start comment generation: ${errorMessage}`);
            return;
        }

        generationStarted = true;
    });

    if (!sendResult.ok) {
        handleRuntimeMessagingFailure(sendResult.error, "open ChatGPT");
        return;
    }

    startPolling();

    window.setTimeout(() => {
        if (!generationStarted && activeWingmanState.postId === postContainer.id) {
            console.error("Wingman: Timed out waiting for background start acknowledgement.");
            clearActiveResults();
            alert("Wingman couldn't confirm that the ChatGPT popup started. Please try again.");
        }
    }, 4000);
    }

    function setActivePost(postContainer, actionBar, button) {
    activeWingmanState.postId = postContainer.id;
    activeWingmanState.postContainer = postContainer;
    activeWingmanState.actionBar = actionBar;
    activeWingmanState.button = button;
    syncWingmanButtonStates();
    }

    function syncWingmanButtonStates() {
    document.querySelectorAll(".wingman-btn").forEach((button) => {
        const isActive = Boolean(activeWingmanState.postId) && button.dataset.postId === activeWingmanState.postId;
        button.classList.toggle("wingman-btn-active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
    }

    function clearActiveResults() {
    stopPolling();
    teardownActiveLayout();

    if (activeWingmanState.resultsContainer?.isConnected) {
        activeWingmanState.resultsContainer.remove();
    }

    activeWingmanState.postId = null;
    activeWingmanState.postContainer = null;
    activeWingmanState.actionBar = null;
    activeWingmanState.button = null;
    activeWingmanState.resultsContainer = null;
    resetWingmanButton();
    syncWingmanButtonStates();
    }

    function teardownActiveLayout() {
    if (activeWingmanState.cleanupLayout) {
        activeWingmanState.cleanupLayout();
        activeWingmanState.cleanupLayout = null;
    }
    }

    function startPolling() {
    stopPolling();

    let pollCount = 0;
    const maxPolls = 180;

    pollingInterval = setInterval(() => {
        pollCount++;
        if (pollCount > maxPolls) {
            stopPolling();
            resetWingmanButton();
            return;
        }

        const sendResult = runtimeGuards.safeSendRuntimeMessage(chrome.runtime, { action: "check_pending_result" }, (response) => {
            if (chrome.runtime.lastError) {
                const error = new Error(chrome.runtime.lastError.message);
                if (runtimeGuards.isExtensionContextInvalidated(error)) {
                    handleRuntimeMessagingFailure(error, "check for generated comments");
                    return;
                }

                console.warn("Wingman: Poll error:", chrome.runtime.lastError.message);
                return;
            }
            if (response && response.hasPending) {
                console.log("Wingman: Received pending result", {
                    targetNodeId: response.targetNodeId,
                    resultLength: response.results?.length || 0,
                    resultPreview: response.results?.slice(0, 220) || ""
                });
                stopPolling();
                renderResults(response.targetNodeId, response.results);
            }
        });

        if (!sendResult.ok) {
            handleRuntimeMessagingFailure(sendResult.error, "check for generated comments");
        }
    }, 1000);
    }

    function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
    }

    function resetWingmanButton() {
    document.querySelectorAll(".wingman-btn.loading").forEach((button) => {
        button.classList.remove("loading");
        button.innerHTML = buildMainBtnHtml(button.dataset.mode || "inline", buildLogoIconHtml());
    });
    }

    function renderResults(targetNodeId, text) {
    if (!activeWingmanState.postId || activeWingmanState.postId !== targetNodeId) {
        console.log("Wingman: Ignoring stale result for inactive post:", targetNodeId);
        return;
    }

    const postContainer = activeWingmanState.postContainer || document.getElementById(targetNodeId);
    const actionBar = activeWingmanState.actionBar;

    if (!postContainer || !actionBar) {
        console.error("Wingman: Could not resolve active container for:", targetNodeId);
        clearActiveResults();
        alert("Wingman: Generated comments are ready, but the post moved. Please try again.");
        return;
    }

    renderResultsInContainer(postContainer, actionBar, text);
    }

    function mountResultsContainer(resultsContainer, postContainer, actionBar) {
    let rafId = 0;

    const applyLayout = () => {
        if (!postContainer.isConnected || !actionBar.isConnected) {
            clearActiveResults();
            return;
        }

        const layout = getCompanionLayout({
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            postRect: postContainer.getBoundingClientRect()
        });
        const isSideLayout = layout.mode === "side";

        resultsContainer.classList.toggle("wingman-results-side", isSideLayout);
        resultsContainer.classList.toggle("wingman-results-inline", !isSideLayout);

        if (isSideLayout) {
            if (resultsContainer.parentElement !== document.body) {
                document.body.appendChild(resultsContainer);
            }

            resultsContainer.style.position = "fixed";
            resultsContainer.style.top = `${layout.top}px`;
            resultsContainer.style.left = `${layout.left}px`;
            resultsContainer.style.width = `${layout.width}px`;
            resultsContainer.style.maxHeight = `${layout.maxHeight}px`;
        } else {
            if (resultsContainer.parentElement !== actionBar.parentElement || resultsContainer.previousElementSibling !== actionBar) {
                actionBar.insertAdjacentElement("afterend", resultsContainer);
            }

            resultsContainer.style.position = "";
            resultsContainer.style.top = "";
            resultsContainer.style.left = "";
            resultsContainer.style.width = "";
            resultsContainer.style.maxHeight = "";
        }
    };

    const requestLayout = () => {
        if (rafId) return;
        rafId = window.requestAnimationFrame(() => {
            rafId = 0;
            if (activeWingmanState.resultsContainer === resultsContainer) {
                applyLayout();
            }
        });
    };

    applyLayout();

    window.addEventListener("resize", requestLayout, { passive: true });
    document.addEventListener("scroll", requestLayout, true);

    return () => {
        if (rafId) {
            window.cancelAnimationFrame(rafId);
        }
        window.removeEventListener("resize", requestLayout);
        document.removeEventListener("scroll", requestLayout, true);
    };
    }

    function setActiveResultsContainer(resultsContainer) {
    teardownActiveLayout();

    if (activeWingmanState.resultsContainer?.isConnected) {
        activeWingmanState.resultsContainer.remove();
    }

    activeWingmanState.resultsContainer = resultsContainer;
    activeWingmanState.cleanupLayout = mountResultsContainer(
        resultsContainer,
        activeWingmanState.postContainer,
        activeWingmanState.actionBar
    );
    }

    function getResultsHintText(optionCount) {
    if (optionCount > 2) {
        return `${optionCount} comments below - scroll for more`;
    }

    if (optionCount === 1) {
        return "1 comment - click to copy";
    }

    return "Click a comment to copy";
    }

    function buildResultsContainer(titleText, optionCount = 0) {
    const resultsContainer = document.createElement("section");
    resultsContainer.className = "wingman-results-container wingman-results-inline";
    if (optionCount > 2) {
        resultsContainer.classList.add("wingman-results-many");
    }

    const header = document.createElement("div");
    header.className = "wingman-header";

    const headerTextGroup = document.createElement("div");
    headerTextGroup.className = "wingman-header-text-group";

    const title = document.createElement("span");
    title.className = "wingman-header-title";
    title.textContent = titleText;

    const hint = document.createElement("span");
    hint.className = "wingman-header-hint";
    hint.textContent = getResultsHintText(optionCount);

    headerTextGroup.appendChild(title);
    headerTextGroup.appendChild(hint);
    header.appendChild(headerTextGroup);
    resultsContainer.appendChild(header);

    const optionsList = document.createElement("div");
    optionsList.className = "wingman-options-list";
    resultsContainer.appendChild(optionsList);

    return resultsContainer;
    }

    function createOptionElement(optionText) {
    const optionElement = document.createElement("div");
    optionElement.className = "wingman-option";
    optionElement.dataset.wingmanOption = "true";
    optionElement.tabIndex = 0;

    const optionTextElement = document.createElement("div");
    optionTextElement.className = "wingman-option-text";
    optionTextElement.textContent = optionText;

    const copyOption = () => {
        navigator.clipboard.writeText(optionText).then(() => {
            optionElement.classList.add("wingman-option-copied");
            setTimeout(() => optionElement.classList.remove("wingman-option-copied"), 2000);
        });
    };

    optionElement.appendChild(optionTextElement);
    optionElement.addEventListener("click", copyOption);
    optionElement.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            copyOption();
        }
    });

    return optionElement;
    }

    function renderResultsInContainer(postContainer, actionBar, text) {
    const btn = activeWingmanState.button || postContainer.querySelector(".wingman-btn");
    if (btn) {
        btn.classList.remove("loading");
        btn.innerHTML = buildMainBtnHtml(btn.dataset.mode || "inline", buildLogoIconHtml());
    }

    if (text.startsWith("Error:")) {
        renderError(postContainer, actionBar, text);
        return;
    }

    const options = parseGeneratedOptions(text);

    console.log("Wingman: Parsed generated options", {
        optionCount: options.length,
        firstOptionPreview: options[0]?.slice(0, 220) || "",
        rawPreview: text.slice(0, 220)
    });

    const resultsContainer = buildResultsContainer("Generated comments", options.length);

    const optionsList = resultsContainer.querySelector(".wingman-options-list");

    options.forEach((optionText) => {
        optionsList.appendChild(createOptionElement(optionText));
    });

    activeWingmanState.postContainer = postContainer;
    activeWingmanState.actionBar = actionBar;
    setActiveResultsContainer(resultsContainer);
    }

    function renderError(postContainer, actionBar, text) {
    const btn = activeWingmanState.button || postContainer.querySelector(".wingman-btn");
    if (btn) {
        btn.classList.remove("loading");
        btn.innerHTML = buildMainBtnHtml(btn.dataset.mode || "inline", buildLogoIconHtml());
    }

    const resultsContainer = buildResultsContainer("Wingman error");
    resultsContainer.classList.add("wingman-error-container");

    const errorElement = document.createElement("div");
    errorElement.className = "wingman-option wingman-error-message";

    const errorTitle = document.createElement("strong");
    errorTitle.textContent = "Sorry, something went wrong.";

    const errorBody = document.createElement("p");
    errorBody.textContent = text;

    const errorHint = document.createElement("small");
    errorHint.textContent = "If the popup still has the response, you can copy it manually.";

    errorElement.appendChild(errorTitle);
    errorElement.appendChild(errorBody);
    errorElement.appendChild(errorHint);
    resultsContainer.appendChild(errorElement);

    activeWingmanState.postContainer = postContainer;
    activeWingmanState.actionBar = actionBar;
    setActiveResultsContainer(resultsContainer);
    }

    if (typeof chrome !== "undefined" && chrome.runtime?.onMessage && typeof document !== "undefined") {
        chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
            if (request.action === "show_results") {
                stopPolling();
                renderResults(request.targetNodeId, request.results);
                sendResponse({ status: "received" });
            }
            return true;
        });

        const observer = new MutationObserver(() => {
            try {
                injectWingmanButtons();
            } catch (error) {
                console.error("Wingman: error injecting buttons", error);
            }
        });

        setTimeout(() => {
            observer.observe(document.body, { childList: true, subtree: true });
            injectWingmanButtons();
        }, 2000);
    }

    globalThis.WingmanLinkedInContentInternals = {
        getInteractiveControls,
        isLikelyPostSocialActionBar,
        looksLikeReactionControl,
        collectPostContainers,
        scoreFooterCandidate,
        findBestFooterCandidate,
        getResultsHintText,
        createOptionElement,
        shouldBlockGenerationForRuntime
    };
})();
