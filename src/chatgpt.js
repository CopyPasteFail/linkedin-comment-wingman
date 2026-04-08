/* global module */

// This script runs in the isolated ChatGPT popup window

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function createFallbackChatGptExtraction() {
    const statusMarkers = [
        "Pending",
        "Searching",
        "Analyzing",
        "Finished searching",
        "Memory updated",
        "Thought for",
        "seconds"
    ];
    const promptArtifactKeywords = [
        "# Role",
        "# Core objective",
        "# Output format",
        "# Quality standard",
        "HERE IS THE LINKEDIN POST",
        "ONLY return the options.",
        "Formatting rules:",
        "...and so on up to option 8"
    ];
    const turnSelectors = [
        '[data-testid^="conversation-turn-"]',
        '[data-message-author-role]',
        '.agent-turn',
        '.turn-assistant',
        'article[data-testid^="conversation-turn-"]',
        'article[data-message-author-role]'
    ];

    function stripStatusMarkers(text) {
        let cleanedText = (text || "").trim();

        statusMarkers.forEach((marker) => {
            const startPattern = new RegExp(`^${marker}[\\s\\n\\r.:]*`, "i");
            const endPattern = new RegExp(`[\\s\\n\\r.:]*${marker}$`, "i");
            cleanedText = cleanedText.replace(startPattern, "").replace(endPattern, "").trim();
        });

        return cleanedText;
    }

    function isLikelyPromptTemplate(text) {
        const cleanedText = stripStatusMarkers(text);
        const keywordHits = promptArtifactKeywords
            .filter((keyword) => cleanedText.includes(keyword))
            .length;

        return keywordHits >= 2 ||
            (cleanedText.includes("# Role") && cleanedText.includes("option 1")) ||
            cleanedText.includes("Return exactly this structure:");
    }

    function shouldAcceptPrimaryExtractionCandidate({ text, isAssistantTurn }) {
        const cleanedText = stripStatusMarkers(text);
        const hasOption1 = /option 1/i.test(cleanedText);
        const hasOption2 = /option 2/i.test(cleanedText);
        const hasOption3 = /option 3/i.test(cleanedText);
        const hasCodeFence = /```(?:text)?/i.test(cleanedText);

        if (!isAssistantTurn || cleanedText.length <= 30 || isLikelyPromptTemplate(cleanedText)) {
            return false;
        }

        return (hasOption1 && hasOption2) || (hasOption1 && hasOption3) || (hasOption1 && hasCodeFence);
    }

    function shouldAcceptAssistantFallback(text) {
        const cleanedText = stripStatusMarkers(text);
        return cleanedText.length > 50 && !isLikelyPromptTemplate(cleanedText);
    }

    function isLikelyConversationTurnElement(element) {
        if (!element) {
            return false;
        }

        const className = String(element.className || "");
        if (/composer/i.test(className) || element.closest?.("form")) {
            return false;
        }

        const testId = element.getAttribute?.("data-testid") || "";
        const role = element.getAttribute?.("data-message-author-role") || "";

        return Boolean(role) ||
            testId.startsWith("conversation-turn-") ||
            element.classList?.contains("agent-turn") ||
            element.classList?.contains("turn-assistant");
    }

    function collectTurns(documentLike) {
        const turns = new Set();

        turnSelectors.forEach((selector) => {
            documentLike.querySelectorAll(selector).forEach((element) => {
                if (isLikelyConversationTurnElement(element)) {
                    turns.add(element);
                }
            });
        });

        return Array.from(turns);
    }

    function getUniqueNodeTexts(nodeList) {
        const uniqueTexts = new Set();

        Array.from(nodeList || []).forEach((node) => {
            const text = stripStatusMarkers(node?.innerText || node?.textContent || "");
            if (text && !isLikelyPromptTemplate(text)) {
                uniqueTexts.add(text);
            }
        });

        return Array.from(uniqueTexts);
    }

    function formatOptionBlocks(blocks) {
        return blocks.map((blockText, index) => [
            `option ${index + 1}`,
            "```text",
            blockText,
            "```"
        ].join("\n")).join("\n\n");
    }

    function isOptionLabel(text) {
        return /^option\s+\d+$/i.test(text.trim());
    }

    function isUiChromeText(text) {
        const normalizedText = text.trim().toLowerCase();
        return normalizedText === "copy" ||
            normalizedText === "share" ||
            normalizedText === "chatgpt can make mistakes. check important info." ||
            normalizedText === "thinking";
    }

    function getRenderedTextBlocks(turn) {
        const selectAll = (selector) => Array.from(turn?.querySelectorAll?.(selector) || []);
        const renderedTexts = getUniqueNodeTexts([
            ...selectAll('[dir="auto"]'),
            ...selectAll(".whitespace-pre-wrap"),
            ...selectAll("p"),
            ...selectAll("li"),
            ...selectAll('[data-message-author-role="assistant"] [dir="auto"]')
        ]);

        return renderedTexts.filter((text) => (
            !isOptionLabel(text) &&
            !isUiChromeText(text) &&
            text.length > 20
        ));
    }

    function extractAssistantTurnText(turn) {
        const rawTurnText = stripStatusMarkers(turn?.innerText || turn?.textContent || "");
        if (shouldAcceptAssistantFallback(rawTurnText)) {
            return rawTurnText;
        }

        const selectAll = (selector) => Array.from(turn?.querySelectorAll?.(selector) || []);
        const codeBlockTexts = getUniqueNodeTexts([
            ...selectAll("pre code"),
            ...selectAll("pre"),
            ...selectAll('[data-testid*="code"]'),
            ...selectAll("code")
        ]);

        if (codeBlockTexts.length > 0) {
            return formatOptionBlocks(codeBlockTexts);
        }

        const renderedTextBlocks = getRenderedTextBlocks(turn);
        if (renderedTextBlocks.length > 0) {
            return formatOptionBlocks(renderedTextBlocks);
        }

        return "";
    }

    function extractDocumentResponseText(documentLike) {
        const pageText = stripStatusMarkers(
            documentLike?.body?.innerText ||
            documentLike?.body?.textContent ||
            ""
        );

        if (pageText.length > 50 && /option\s+\d+/i.test(pageText) && !isLikelyPromptTemplate(pageText)) {
            return pageText;
        }

        return "";
    }

    return {
        collectTurns,
        extractDocumentResponseText,
        extractAssistantTurnText,
        stripStatusMarkers,
        isLikelyPromptTemplate,
        shouldAcceptPrimaryExtractionCandidate,
        shouldAcceptAssistantFallback
    };
}

const chatGptExtraction = globalThis.WingmanChatGptExtraction || createFallbackChatGptExtraction();

async function checkTasks() {
    chrome.runtime.sendMessage({ action: 'chatgpt_ready' }, async (response) => {
        if (response && response.action === 'process_prompt') {
            console.log("Wingman ChatGPT: Received prompt, starting automation...");
            await automateChat(response.prompt);
        }
    });
}

/**
 * Helper to find all "turns" (message blocks) in the chat.
 * ChatGPT frequently changes between <article>, [data-testid], and [data-message-author-role].
 */
function getTurns() {
    return chatGptExtraction.collectTurns(document);
}

async function automateChat(prompt) {
    // 1. Find the text area (now a ProseMirror contenteditable div)
    let textArea = null;
    let retries = 30;
    while (retries > 0) {
        textArea = document.querySelector('#prompt-textarea');
        if (textArea) break;
        textArea = document.querySelector('textarea');
        if (textArea) break;
        await sleep(500);
        retries--;
    }

    if (!textArea) {
        console.error("Wingman ChatGPT: Could not find chat text area.");
        chrome.runtime.sendMessage({ action: 'chatgpt_result', text: "Error: Could not find ChatGPT input field." });
        return;
    }

    console.log("Wingman ChatGPT: Found input element:", textArea.tagName, textArea.id);

    // 2. Insert the text in chunks using execCommand (most reliable for ProseMirror)
    textArea.focus();
    await sleep(300);

    // Clear any existing content
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    await sleep(200);

    // Insert text in chunks to avoid size limits
    const CHUNK_SIZE = 300;
    for (let i = 0; i < prompt.length; i += CHUNK_SIZE) {
        const chunk = prompt.slice(i, i + CHUNK_SIZE);
        document.execCommand('insertText', false, chunk);
        // Small delay between chunks to let ProseMirror process
        if (i + CHUNK_SIZE < prompt.length) {
            await sleep(30);
        }
    }

    await sleep(500);
    
    // Verify text was inserted
    const currentText = textArea.innerText || textArea.textContent || '';
    console.log("Wingman ChatGPT: Text area content length after insert:", currentText.length, "expected:", prompt.length);

    if (currentText.trim().length < 50) {
        console.error("Wingman ChatGPT: Text insertion failed. Trying fallback...");
        // Fallback: set innerHTML directly (won't update ProseMirror state but worth trying)
        textArea.focus();
        textArea.innerHTML = '<p>' + prompt.replace(/\n/g, '</p><p>') + '</p>';
        textArea.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(500);
    }

    // Count existing turns before we submit
    const preExistingTurns = getTurns().length;
    console.log("Wingman ChatGPT: Pre-existing turns:", preExistingTurns);

    await sleep(500);

    // 3. Find and click the submit button
    let sendBtn = null;
    let sendRetries = 10;
    while (sendRetries > 0) {
        sendBtn = document.querySelector('#composer-submit-button:not([disabled])');
        if (!sendBtn) sendBtn = document.querySelector('button[aria-label="Send prompt"]:not([disabled])');
        if (!sendBtn) sendBtn = document.querySelector('button[data-testid="send-button"]:not([disabled])');
        if (sendBtn) break;
        await sleep(500);
        sendRetries--;
    }
    
    if (sendBtn) {
        console.log("Wingman ChatGPT: Clicking send button...");
        sendBtn.click();
    } else {
        console.log("Wingman ChatGPT: No enabled send button found, trying Enter key...");
        textArea.focus();
        textArea.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true, cancelable: true, keyCode: 13, key: 'Enter'
        }));
    }

    // 4. Wait for generation to start
    console.log("Wingman ChatGPT: Waiting for generation to start...");
    let generationStarted = false;
    let startTimeout = 25;
    while (!generationStarted && startTimeout > 0) {
        await sleep(1000);
        startTimeout--;
        const stopBtn = document.querySelector('button[aria-label="Stop streaming"]') 
                      || document.querySelector('[data-testid="stop-button"]');
        
        const currentTurns = getTurns();
        if (stopBtn || currentTurns.length > preExistingTurns) {
            generationStarted = true;
            console.log("Wingman ChatGPT: Generation started! (New turns detected or Stop button visible)");
        }
    }

    if (!generationStarted) {
        console.error("Wingman ChatGPT: Generation never started.");
        chrome.runtime.sendMessage({ action: 'chatgpt_result', text: "Error: ChatGPT did not start generating. Try again or check the chat popup." });
        return;
    }

    // 5. Wait for generation to finish
    console.log("Wingman ChatGPT: Waiting for generation to finish...");
    let isGenerating = true;
    let timeout = 120;
    while (isGenerating && timeout > 0) {
        await sleep(1000);
        timeout--;
        
        const stopBtn = document.querySelector('button[aria-label="Stop streaming"]') 
                      || document.querySelector('[data-testid="stop-button"]');
        
        // Ensure the stop button is truly gone for at least 2 seconds before we conclude
        if (!stopBtn) {
            await sleep(2000);
            const stopBtnCheck = document.querySelector('button[aria-label="Stop streaming"]') 
                               || document.querySelector('[data-testid="stop-button"]');
            if (!stopBtnCheck) {
                isGenerating = false;
            }
        }
    }

    // Give it a moment to finalize rendering (ChatGPT UI sometimes updates status markers for 1-2s)
    await sleep(3500);

    console.log("Wingman ChatGPT: Generation complete. Extracting result...");

    // 6. Extract the generated text using Universal + Marker-based methodology
    const assistantSelectors = [
        '[data-message-author-role="assistant"] .markdown',
        '.agent-turn .markdown',
        '.turn-assistant .markdown',
        '.markdown.prose',
        '.prose',
        'article .markdown',
        '[dir="auto"]',
        '.whitespace-pre-wrap',
        '.markdown'
    ];

    let extractedText = '';
    const allTurns = getTurns();
    
    // -- DIAGNOSTICS --
    console.log(`Wingman Diagnostic: Final count of turns: ${allTurns.length}`);
    console.log("Wingman ChatGPT: Recent turn summaries", allTurns.slice(-5).map((turn, index) => ({
        index: allTurns.length - Math.min(5, allTurns.length) + index,
        role: turn.getAttribute?.("data-message-author-role") || "",
        classes: turn.className || "",
        preview: (turn.innerText || turn.textContent || "").trim().slice(0, 140)
    })));

    // Strategy 1: Look for assistant content within known turns from the back
    console.log("Wingman ChatGPT: Primary extraction attempt starting...");
    for (const selector of assistantSelectors) {
        for (let i = allTurns.length - 1; i >= 0; i--) {
            const turn = allTurns[i];
            const role = turn.getAttribute?.("data-message-author-role") || "";
            const isAssistantTurn = role === "assistant" ||
                turn.classList.contains("agent-turn") ||
                turn.querySelector?.('[data-message-author-role="assistant"]');

            if (!isAssistantTurn) {
                continue;
            }

            const contentCandidates = turn.querySelectorAll(selector);
            
            // If the turn itself matches the selector, check it too
            const candidates = turn.matches?.(selector) ? [turn, ...contentCandidates] : [...contentCandidates];
            
            for (const el of candidates) {
                const rawText = (el.innerText || el.textContent || "").trim();
                const msgText = chatGptExtraction.stripStatusMarkers(rawText);

                if (chatGptExtraction.shouldAcceptPrimaryExtractionCandidate({
                    text: msgText,
                    isAssistantTurn: true
                })) {
                    extractedText = msgText;
                    console.log(`Wingman ChatGPT: Success! Extracted ${extractedText.length} chars from turn ${i} using selector: ${selector}`);
                    break;
                }
            }
            if (extractedText) break;
        }
        if (extractedText) break;
    }

    // Strategy 2: Emergency Response - Fallback to any assistant turn's full text
    if (!extractedText) {
        console.warn("Wingman ChatGPT: Primary extraction failed. Using last-resort turn recovery.");
        for (let i = allTurns.length - 1; i >= 0; i--) {
            const turn = allTurns[i];
            const role = turn.getAttribute('data-message-author-role');
            const isAgent = turn.classList.contains('agent-turn');
            const turnText = chatGptExtraction.extractAssistantTurnText(turn);
            
            // If it's an assistant/agent turn, and has some length
            if ((role === 'assistant' || isAgent) && turnText) {
                extractedText = turnText;
                console.log(`Wingman ChatGPT: Emergency recovery! Took full innerText from turn ${i} (role=${role}, agent=${isAgent}).`);
                break;
            }
        }
    }

    if (!extractedText) {
        extractedText = chatGptExtraction.extractDocumentResponseText(document);
        if (extractedText) {
            console.log("Wingman ChatGPT: Page-level fallback recovered visible response text.", {
                extractedLength: extractedText.length,
                preview: extractedText.slice(0, 220)
            });
        }
    }

    if (extractedText) {
        chrome.runtime.sendMessage({ action: 'chatgpt_result', text: extractedText }, (response) => {
            console.log("Wingman ChatGPT: Result sent. Response from BG:", response);
        });
    } else {
        const lastTurnClass = allTurns.length > 0 ? allTurns[allTurns.length-1].className : 'No turns found.';
        chrome.runtime.sendMessage({ action: 'chatgpt_result', text: `Error: Extraction failed after generation. Last turn class: ${lastTurnClass}` });
    }
}

if (typeof globalThis !== "undefined") {
    globalThis.WingmanChatGptRuntime = {
        createFallbackChatGptExtraction
    };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        createFallbackChatGptExtraction
    };
}

// Start checking when loaded
if (typeof window !== "undefined") {
    window.addEventListener('load', () => {
        console.log("Wingman ChatGPT: Page loaded. Automation waiting...");
        setTimeout(checkTasks, 2500);
    });
}
