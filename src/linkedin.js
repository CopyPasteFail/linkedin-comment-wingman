(() => {
    if (globalThis.WingmanLinkedInContentScriptLoaded) {
        return;
    }

    globalThis.WingmanLinkedInContentScriptLoaded = true;

    let postIdCounter = 0;
    const processedButtons = new WeakSet();
    const runtimeGuards = globalThis.WingmanRuntimeGuards || {
        createRuntimeUnavailableError: () => new Error("Wingman extension runtime is unavailable."),
        isExtensionContextInvalidated: (error) => Boolean(error?.message) && /extension context invalidated/i.test(error.message),
        safeSendRuntimeMessage: (runtime, message, callback) => {
            if (!runtime?.sendMessage) {
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

    console.log("Wingman Extension: Content script loaded and running!");

    function normalizeText(value) {
    return (value || "").trim().toLowerCase();
    }

    function safeString(value) {
    return typeof value === "string" ? value : "";
    }

    function getInteractiveControls(root) {
    return Array.from(root?.querySelectorAll?.("button, [role='button'], a") || [])
        .filter((element) => !element.classList?.contains("wingman-btn"));
    }

    function getControlLabel(control) {
    return {
        text: normalizeText(safeString(control?.innerText || control?.textContent)),
        aria: normalizeText(safeString(control?.getAttribute?.("aria-label"))),
        className: normalizeText(safeString(control?.className))
    };
    }

    function looksLikeReactionControl(controlLike) {
    const controlText = controlLike?.text ?? controlLike?.innerText ?? controlLike?.textContent;
    const controlAria = controlLike?.aria ?? controlLike?.getAttribute?.("aria-label");
    const controlClassName = controlLike?.className;
    const text = safeString(controlText).toLowerCase();
    const aria = safeString(controlAria).toLowerCase();
    const className = safeString(controlClassName).toLowerCase();

    console.log("Wingman reaction probe", {
        text: controlText,
        aria: controlAria,
        className: controlClassName
    });

    return text === "like" ||
        text === "open reactions menu" ||
        aria.includes("reaction button state") ||
        aria.includes("like") ||
        aria.includes("open reactions menu") ||
        className.includes("reaction");
    }

    function looksLikeCommentControl({ text, aria }) {
    text = safeString(text).toLowerCase();
    aria = safeString(aria).toLowerCase();
    return text === "comment" || aria.includes("comment");
    }

    function looksLikeRepostControl({ text, aria }) {
    text = safeString(text).toLowerCase();
    aria = safeString(aria).toLowerCase();
    return text === "repost" || aria.includes("repost");
    }

    function looksLikeSendControl({ text, aria }) {
    text = safeString(text).toLowerCase();
    aria = safeString(aria).toLowerCase();
    return text === "send" || aria.includes("send");
    }

    function looksLikeNoiseControl({ text, aria }) {
    const combined = `${safeString(text).toLowerCase()} ${safeString(aria).toLowerCase()}`;
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

    console.log("Wingman feed debug candidates", scoredCandidates.slice(0, 3).map((entry) => ({
        score: entry.score,
        controlCount: entry.controlCount,
        tokens: entry.tokens,
        distanceFromBottom: entry.distanceFromBottom
    })));

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

    console.log("Wingman feed debug post roots", discoveredRoots.slice(0, 10).map((root) => ({
        tagName: root?.tagName || null,
        className: root?.className || null,
        textPreview: (root?.innerText || root?.textContent || "").trim().slice(0, 160),
        hasReactionControl: getInteractiveControls(root).some(looksLikeReactionControl),
        hasPostMenu: Array.from(root?.querySelectorAll?.('[aria-label*="Open control menu for post by" i]') || []).length > 0,
        interactiveCount: getInteractiveControls(root).length
    })));

    return discoveredRoots;
    }

    function handleRuntimeMessagingFailure(error, actionDescription) {
    console.error(`Wingman: ${actionDescription} failed:`, error?.message || error);
    clearActiveResults();

    if (runtimeGuards.isExtensionContextInvalidated(error)) {
        if (!extensionReloadNoticeShown) {
            extensionReloadNoticeShown = true;
            alert("Wingman was reloaded or updated. Refresh this LinkedIn tab and try again.");
        }
        return;
    }

    alert(`Wingman couldn't ${actionDescription}: ${error?.message || "Unknown error"}`);
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

        const wingmanBtn = document.createElement("button");
        wingmanBtn.className = "wingman-btn";
        wingmanBtn.dataset.postId = postContainer.id;
        wingmanBtn.innerHTML = `<span class="wingman-btn-icon">${wingmanUiSymbols.WINGMAN_IDLE_SYMBOL}</span> Wingman`;
        wingmanBtn.style.cssText = "display: inline-flex !important; visibility: visible !important; opacity: 1 !important;";
        wingmanBtn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            handleWingmanClick(wingmanBtn, postContainer, actionBar);
        });

        try {
            actionBar.appendChild(wingmanBtn);
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
            return element.innerText || element.textContent;
        }
    }

    const clone = postContainer.cloneNode(true);
    const noiseSelectors = [
        ".feed-shared-update-v2__social-row",
        ".feed-shared-social-action-bar",
        ".update-v2-social-activity",
        ".comment-social-bar",
        ".wingman-btn",
        ".wingman-results-container",
        "button",
        "footer"
    ];

    noiseSelectors.forEach((selector) => {
        clone.querySelectorAll(selector).forEach((element) => element.remove());
    });

    const text = clone.innerText || clone.textContent || "";
    return text.slice(0, 2000).trim();
    }

    function handleWingmanClick(btn, postContainer, actionBar) {
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

    console.log("Wingman: Starting generation for post", {
        postId: postContainer.id,
        textLength: postText.length,
        textPreview: postText.slice(0, 180)
    });

    clearActiveResults();
    setActivePost(postContainer, actionBar, btn);

    btn.classList.add("loading");
    btn.innerHTML = `<span class="wingman-btn-icon">${wingmanUiSymbols.WINGMAN_LOADING_SYMBOL}</span> Wingman`;

    let generationStarted = false;
    const sendResult = runtimeGuards.safeSendRuntimeMessage(chrome.runtime, {
        action: "generate_comments",
        postText,
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
        button.innerHTML = `<span class="wingman-btn-icon">${wingmanUiSymbols.WINGMAN_IDLE_SYMBOL}</span> Wingman`;
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

    function buildResultsContainer(titleText) {
    const resultsContainer = document.createElement("section");
    resultsContainer.className = "wingman-results-container wingman-results-inline";

    const header = document.createElement("div");
    header.className = "wingman-header";

    const title = document.createElement("span");
    title.className = "wingman-header-title";
    title.textContent = titleText;

    const hint = document.createElement("span");
    hint.className = "wingman-header-hint";
    hint.textContent = "Click a comment to copy";

    header.appendChild(title);
    header.appendChild(hint);
    resultsContainer.appendChild(header);

    return resultsContainer;
    }

    function renderResultsInContainer(postContainer, actionBar, text) {
    const btn = activeWingmanState.button || postContainer.querySelector(".wingman-btn");
    if (btn) {
        btn.classList.remove("loading");
        btn.innerHTML = `<span class="wingman-btn-icon">${wingmanUiSymbols.WINGMAN_IDLE_SYMBOL}</span> Wingman`;
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

    const resultsContainer = buildResultsContainer("Generated comments");

    options.forEach((optionText) => {
        const optionElement = document.createElement("button");
        optionElement.type = "button";
        optionElement.className = "wingman-option";
        optionElement.textContent = optionText;
        optionElement.addEventListener("click", () => {
            navigator.clipboard.writeText(optionText).then(() => {
                optionElement.classList.add("wingman-option-copied");
                setTimeout(() => optionElement.classList.remove("wingman-option-copied"), 2000);
            });
        });
        resultsContainer.appendChild(optionElement);
    });

    activeWingmanState.postContainer = postContainer;
    activeWingmanState.actionBar = actionBar;
    setActiveResultsContainer(resultsContainer);
    }

    function renderError(postContainer, actionBar, text) {
    const btn = activeWingmanState.button || postContainer.querySelector(".wingman-btn");
    if (btn) {
        btn.classList.remove("loading");
        btn.innerHTML = `<span class="wingman-btn-icon">${wingmanUiSymbols.WINGMAN_IDLE_SYMBOL}</span> Wingman`;
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
        findBestFooterCandidate
    };
})();
