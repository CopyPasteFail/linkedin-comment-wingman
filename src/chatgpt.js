// This script runs in the isolated ChatGPT popup window

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

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
    const turnSelectors = [
        'article',
        '[data-testid^="conversation-turn-"]',
        '[data-message-author-role]',
        '.agent-turn',
        '.turn',
        'main .group'
    ];
    
    // Use a Set to ensure uniqueness when using multiple broad selectors
    const turns = new Set();
    turnSelectors.forEach(s => {
        document.querySelectorAll(s).forEach(el => turns.add(el));
    });
    
    return Array.from(turns);
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

    console.log("Wingman ChatGPT: Generation complete. Extracting result...");

    // Give it a moment to finalize rendering
    await sleep(2000);

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

    // Strategy 1: Look for assistant content within known turns from the back
    console.log("Wingman ChatGPT: Primary extraction attempt starting...");
    for (const selector of assistantSelectors) {
        for (let i = allTurns.length - 1; i >= 0; i--) {
            const turn = allTurns[i];
            const contentCandidates = turn.querySelectorAll(selector);
            
            // If the turn itself matches the selector, check it too
            const candidates = turn.matches?.(selector) ? [turn, ...contentCandidates] : [...contentCandidates];
            
            for (const el of candidates) {
                const msgText = (el.innerText || el.textContent || '').trim();
                
                // --- SUCCESS MARKERS ---
                // If it contains multiple options, it's a high-confidence success
                const hasOption1 = /option 1/i.test(msgText);
                const hasOption2 = /option 2/i.test(msgText);
                const hasOption3 = /option 3/i.test(msgText);
                const isHighConfidence = hasOption1 && hasOption2 && hasOption3;

                // --- NOISE FILTER ---
                // If it's just the prompt instructions without any options
                const isPromptOnly = msgText.includes("# Role") && 
                                   msgText.includes("# Core objective") && 
                                   !hasOption1;
                
                if (msgText.length > 30 && (isHighConfidence || (!isPromptOnly && (hasOption1)))) {
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
            const turnText = (turn.innerText || '').trim();
            
            // If it's an assistant/agent turn, and has some length
            if ((role === 'assistant' || isAgent) && turnText.length > 50) {
                extractedText = turnText;
                console.log(`Wingman ChatGPT: Emergency recovery! Took full innerText from turn ${i} (role=${role}, agent=${isAgent}).`);
                break;
            }
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

// Start checking when loaded
window.addEventListener('load', () => {
    console.log("Wingman ChatGPT: Page loaded. Automation waiting...");
    setTimeout(checkTasks, 2500);
});
