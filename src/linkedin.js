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
    const resolvePostContainer = wingmanPostContext.resolvePostContainer || (() => null);
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
    const buttons = document.querySelectorAll("button");

    buttons.forEach((btn) => {
        if (processedButtons.has(btn)) return;

        const ariaLabel = btn.getAttribute("aria-label") || "";
        const span = btn.querySelector("span");
        const textContent = (span ? span.textContent : btn.textContent).trim();

        let actionBar = null;
        let current = btn.parentElement;
        let depth = 0;
        while (current && depth < 5) {
            const childBtns = current.querySelectorAll("button");
            if (childBtns.length >= 3) {
                actionBar = current;
                break;
            }
            current = current.parentElement;
            depth++;
        }

        if (!actionBar) return;

        const postContainer = resolvePostContainer(btn, actionBar, document.body);

        const actionButtons = Array.from(actionBar.querySelectorAll("button"))
            .filter((candidate) => !candidate.classList.contains("wingman-btn"));
        const buttonIndex = actionButtons.indexOf(btn);
        const hasCommentComposer = Boolean(
            postContainer?.querySelector(".comments-comment-box__form") ||
            postContainer?.querySelector(".comments-comment-texteditor") ||
            postContainer?.querySelector('[contenteditable="true"][role="textbox"]') ||
            postContainer?.querySelector('textarea[placeholder*="comment" i]')
        );

        const isCommentLogic = isLikelyCommentButton({
            ariaLabel,
            textContent,
            buttonIndex,
            actionButtonCount: actionButtons.length,
            hasCommentComposer,
            withinPostContainer: Boolean(postContainer)
        });

        if (!isCommentLogic) return;

        processedButtons.add(btn);

        if (!postContainer) return;

        if (!postContainer.id) {
            postContainer.id = "wingman-post-" + (++postIdCounter);
        }

        if (actionBar.querySelector(".wingman-btn")) return;

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
})();
