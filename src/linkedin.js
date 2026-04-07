let postIdCounter = 0;
const processedButtons = new WeakSet();

console.log("Wingman Extension: Content script loaded and running!");

function injectWingmanButtons() {
    // 1. Find the "Comment" buttons via span text or aria-label
    const buttons = document.querySelectorAll('button');
    
    buttons.forEach(btn => {
        // Skip if already processed using WeakSet to avoid DOM mutations that crash React
        if (processedButtons.has(btn)) return;
        
        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase().trim();
        const span = btn.querySelector('span');
        const textContent = (span ? span.textContent : btn.textContent).trim().toLowerCase();
        
        // Exact matching to prevent matching "load more comments" or "view more options for X's comment"
        const isCommentLogic = textContent === 'comment' || textContent === 'הגב' || 
                               ariaLabel === 'comment' || ariaLabel === 'הגב' || 
                               ariaLabel.startsWith('comment on');
        
        if (isCommentLogic) {
            console.log("Wingman: Found a comment button candidate!", {ariaLabel, textContent, btn});
            processedButtons.add(btn);
            
            // Find the action bar by searching up for a container holding multiple buttons (Like, Comment, Repost, Send)
            // This is immune to LinkedIn changing their class names
            let actionBar = null;
            let current = btn.parentElement;
            let depth = 0;
            while (current && depth < 5) {
                // Check if this container holds multiple distinct buttons
                const childBtns = current.querySelectorAll('button');
                if (childBtns.length >= 3) {
                    actionBar = current;
                    break;
                }
                current = current.parentElement;
                depth++;
            }
            
            if (actionBar) {
                console.log("Wingman: Found action bar for button!", actionBar);
                
                // Find the closest post container.
                // We use a prioritized list and avoid generic selectors like ".relative" or ".update-v2-social-activity"
                // which might be too small and only contain the buttons themselves.
                const postSelectors = [
                    '.feed-shared-update-v2', 
                    '.update-components-article', 
                    'article', 
                    '.occludable-update',
                    '.fie-impression-container',
                    '[data-urn]',
                    '[data-id]'
                ];
                
                let postContainer = btn.closest(postSelectors.join(', '));
                
                if (!postContainer) {
                    console.log("Wingman: Using structural fallback for postContainer");
                    // Step up ~4-5 levels from the action bar. The post wrapper usually contains the header, body, and action bar.
                    postContainer = actionBar;
                    for (let i = 0; i < 5; i++) {
                        if (postContainer.parentElement && postContainer.parentElement !== document.body) {
                            postContainer = postContainer.parentElement;
                            // If we hit an article or a recognized feed item, stop there
                            if (postContainer.tagName === 'ARTICLE' || postContainer.classList.contains('feed-shared-update-v2')) {
                                break;
                            }
                        }
                    }
                }
                
                if (!postContainer) {
                    console.log("Wingman ERROR: Still could not resolve postContainer", btn);
                    return;
                }
                
                if (!postContainer.id) {
                    postContainer.id = 'wingman-post-' + (++postIdCounter);
                }

                console.log("Wingman: Post container identified:", postContainer.id);

                // Create the button (if not already added to this action bar)
                if (!actionBar.querySelector('.wingman-btn')) {
                    console.log("Wingman: Injecting wingmanBtn into action bar!");
                    const wingmanBtn = document.createElement('button');
                    wingmanBtn.className = 'wingman-btn';
                    wingmanBtn.innerHTML = '<span class="wingman-btn-icon">✨</span> Wingman';
                    
                    // We'll add some inline styles to force visibility in case LinkedIn CSS hides it
                    wingmanBtn.style.cssText = "display: inline-flex !important; visibility: visible !important; opacity: 1 !important;";
                    
                    wingmanBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        console.log("Wingman: Clicked!");
                        handleWingmanClick(wingmanBtn, postContainer);
                    });

                    // Append the button safely
                    try {
                        actionBar.appendChild(wingmanBtn);
                        console.log("Wingman: Successfully appended button.");
                    } catch(err) {
                        console.error("Wingman: Error appending button:", err);
                    }
                } else {
                     console.log("Wingman: Toolbar already has a wingman button. Skipping.");
                }
            } else {
                console.log("Wingman: Candidate button did NOT have a recognized action bar ancestor.");
            }
        }
    });
}

function extractPostText(postContainer) {
    // 1. Try reliable structural/attribute hooks for the main content first
    const contentSelectors = [
        '.update-components-text',
        '.feed-shared-update-v2__description',
        '.feed-shared-inline-show-more-text',
        '.update-components-text--core',
        '.feed-shared-annotated-text',
        '.feed-shared-article__description',
        '[data-test-id="main-feed-activity-card__commentary"]'
    ];
    
    for (const selector of contentSelectors) {
        const el = postContainer.querySelector(selector);
        if (el && el.textContent.trim().length > 10) {
            console.log("Wingman: Extracted text using specific selector:", selector);
            return el.innerText || el.textContent;
        }
    }
    
    // 2. Ultimate fallback: grab everything, but filter out common UI noise
    console.log("Wingman: extractPostText used ultimate innerText fallback on container:", postContainer.id);
    
    // Clone to avoid modifying the actual page
    const clone = postContainer.cloneNode(true);
    
    // Remove noise elements from the clone before getting innerText
    const noiseSelectors = [
        '.feed-shared-update-v2__social-row',
        '.feed-shared-social-action-bar',
        '.update-v2-social-activity',
        '.comment-social-bar',
        '.wingman-btn',
        '.wingman-results-container',
        'button',
        'footer'
    ];
    
    noiseSelectors.forEach(s => {
        clone.querySelectorAll(s).forEach(el => el.remove());
    });
    
    const text = clone.innerText || clone.textContent || '';
    return text.slice(0, 2000).trim();
}

let pollingInterval = null;

function handleWingmanClick(btn, postContainer) {
    const postText = extractPostText(postContainer);
    if (!postText.trim()) {
        alert("Wingman: Couldn't extract text from this post.");
        return;
    }

    btn.classList.add('loading');
    btn.innerHTML = '<span class="wingman-btn-icon">⏳</span> Thinking...';

    // Remove old results if they exist
    const oldContainer = postContainer.querySelector('.wingman-results-container');
    if (oldContainer) oldContainer.remove();

    chrome.runtime.sendMessage({
        action: 'generate_comments',
        postText: postText,
        targetNodeId: postContainer.id
    }, (response) => {
        console.log("Wingman: generate_comments response:", response);
    });

    // Start polling for results as a backup delivery mechanism
    startPolling();
}

function startPolling() {
    // Clear any existing poll
    if (pollingInterval) clearInterval(pollingInterval);
    
    console.log("Wingman: Starting polling for results...");
    let pollCount = 0;
    const maxPolls = 180; // 3 minutes max (180 * 1s)
    
    pollingInterval = setInterval(() => {
        pollCount++;
        if (pollCount > maxPolls) {
            console.log("Wingman: Polling timeout reached, stopping.");
            stopPolling();
            resetWingmanButton();
            return;
        }
        
        chrome.runtime.sendMessage({ action: 'check_pending_result' }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn("Wingman: Poll error:", chrome.runtime.lastError.message);
                return;
            }
            if (response && response.hasPending) {
                console.log("Wingman: 🎉 Received result via polling! Text length:", response.results?.length);
                stopPolling();
                renderResults(response.targetNodeId, response.results);
            }
        });
    }, 1000);
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}

function resetWingmanButton() {
    // Reset all loading wingman buttons
    document.querySelectorAll('.wingman-btn.loading').forEach(btn => {
        btn.classList.remove('loading');
        btn.innerHTML = '<span class="wingman-btn-icon">✨</span> Wingman';
    });
}

function renderResults(targetNodeId, text) {
    console.log("Wingman: renderResults called for:", targetNodeId, "text length:", text?.length);
    
    const postContainer = document.getElementById(targetNodeId);
    if (!postContainer) {
        console.error("Wingman: Could not find post container with id:", targetNodeId);
        // Try to show it on the first wingman post we can find
        const anyPost = document.querySelector('[id^="wingman-post-"]');
        if (anyPost) {
            console.log("Wingman: Falling back to first available post container:", anyPost.id);
            renderResultsInContainer(anyPost, text);
        } else {
            console.error("Wingman: No wingman post containers found at all!");
            alert("Wingman: Generated comments are ready but the post container was lost. Please try again.");
        }
        return;
    }

    renderResultsInContainer(postContainer, text);
}

function renderResultsInContainer(postContainer, text) {
    // Reset button
    const btn = postContainer.querySelector('.wingman-btn');
    if (btn) {
        btn.classList.remove('loading');
        btn.innerHTML = '<span class="wingman-btn-icon">✨</span> Wingman';
    }

    // 0. Pre-process: Filter out prompt noise/instructions
    let cleanText = text;
    const promptKeywords = [
        "Write short LinkedIn comments", 
        "HERE IS THE LINKEDIN POST", 
        "Output count:", 
        "Writing rules:",
        "Return exactly 8 options",
        "in this format",
        "# Role",
        "# Core objective",
        "Quality standard"
    ];
    
    // If we find prompt keywords, try to find the actual start of options
    const firstOptionIndex = text.search(/option 1/i);
    const firstCodeBlockIndex = text.indexOf("```");
    
    if (firstOptionIndex !== -1 || firstCodeBlockIndex !== -1) {
        const startIndex = (firstOptionIndex !== -1 && (firstCodeBlockIndex === -1 || firstOptionIndex < firstCodeBlockIndex)) 
            ? firstOptionIndex 
            : firstCodeBlockIndex;
        
        // Only trim if the noise is at the beginning
        if (startIndex > 50) { 
            console.log("Wingman: Trimming prompt noise from start, index:", startIndex);
            cleanText = text.substring(startIndex);
        }
    }

    // Also remove everything after the last option if there's significant noise
    const lastOptionMatch = [...cleanText.matchAll(/option \d+/gi)].pop();
    if (lastOptionMatch) {
        const lastIndex = lastOptionMatch.index;
        const remaining = cleanText.substring(lastIndex);
        // If there's a lot of text after the last option that looks like instructions or metadata
        if (remaining.includes("ChatGPT can make mistakes") || remaining.includes("# Quality standard")) {
             // Find where the last block really ends
             const lastClosingBlock = remaining.lastIndexOf("```");
             if (lastClosingBlock !== -1) {
                 cleanText = cleanText.substring(0, lastIndex + lastClosingBlock + 3);
             }
        }
    }

    // 0.5. Check if it's an error message
    if (text.startsWith('Error:')) {
        console.log("Wingman: Detected error message from AI, displaying as single block.");
        renderError(postContainer, text);
        return;
    }

    // 1. Try the standard markdown block regex
    const regex = /option \d+\n```(?:text)?\n([\s\S]*?)\n```/g;
    let match;
    const options = [];
    while ((match = regex.exec(cleanText)) !== null) {
        options.push(match[1].trim());
    }

    // 2. If that fails, try a more lenient split by "option X"
    if (options.length === 0) {
        console.log("Wingman: Standard regex failed, trying lenient split on cleaned text...");
        // Split by the "option X" pattern. \b ensures we match word boundaries.
        // We don't require a preceding newline anymore as some UI views might collapse them.
        const parts = cleanText.split(/\boption \d+[:\s\r\n]*/i);
        
        parts.forEach(part => {
            let cleaned = part.trim()
                .replace(/^```(text|markdown|plain)?/i, '') // Remove opening backticks
                .replace(/```$/i, '')                       // Remove closing backticks
                .trim();
            
            // Further cleaning for trailing artifacts
            cleaned = cleaned.replace(/[\n\r\t\s]+option$/i, '').trim();
            
            // Check if this part is just instructions we missed
            const looksLikeInstruction = promptKeywords.some(kw => cleaned.includes(kw)) || 
                                       cleaned.length < 5 || 
                                       (cleaned.includes("Return exactly") && cleaned.includes("options"));
            
            if (!looksLikeInstruction) {
                options.push(cleaned);
            }
        });
    }

    // 3. Last resort fallback
    if (options.length === 0) {
        console.log("Wingman: All parsing failed or text was invalid.");
        options.push("Error: Could not extract comments. Please check the ChatGPT popup window.");
    }

    console.log("Wingman: Parsed", options.length, "comment options");

    // Remove old results container if it exists
    const oldContainer = postContainer.querySelector('.wingman-results-container');
    if (oldContainer) oldContainer.remove();

    const resultsContainer = document.createElement('div');
    resultsContainer.className = 'wingman-results-container';

    const header = document.createElement('div');
    header.className = 'wingman-header';
    header.innerHTML = '✨ Generated Comments (Click to copy)';
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'wingman-close-btn';
    closeBtn.innerHTML = '✕';
    closeBtn.onclick = () => resultsContainer.remove();
    header.appendChild(closeBtn);
    
    resultsContainer.appendChild(header);

    options.forEach((optText) => {
        const optDiv = document.createElement('div');
        optDiv.className = 'wingman-option';
        
        // Preserve line breaks
        optDiv.innerHTML = optText.replace(/\n/g, '<br>');
        
        optDiv.onclick = () => {
            navigator.clipboard.writeText(optText).then(() => {
                optDiv.classList.add('wingman-option-copied');
                setTimeout(() => optDiv.classList.remove('wingman-option-copied'), 2000);
            });
        };
        resultsContainer.appendChild(optDiv);
    });

    // Append to the post
    postContainer.appendChild(resultsContainer);
    console.log("Wingman: ✅ Results container appended to post!", postContainer.id);
    
    // Scroll the results into view
    resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderError(postContainer, text) {
    const resultsContainer = document.createElement('div');
    resultsContainer.className = 'wingman-results-container wingman-error-container';

    const header = document.createElement('div');
    header.className = 'wingman-header';
    header.innerHTML = '⚠️ Wingman Extraction Error';
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'wingman-close-btn';
    closeBtn.innerHTML = '✕';
    closeBtn.onclick = () => resultsContainer.remove();
    header.appendChild(closeBtn);
    
    resultsContainer.appendChild(header);

    const errorDiv = document.createElement('div');
    errorDiv.className = 'wingman-option wingman-error-message';
    errorDiv.style.borderColor = '#ff4d4f';
    errorDiv.style.backgroundColor = 'rgba(255, 77, 79, 0.05)';
    errorDiv.innerHTML = `<strong>Sorry, something went wrong:</strong><br><br>${text}<br><br><small>If you see the response in the opened ChatGPT window, you can copy it manually.</small>`;
    
    resultsContainer.appendChild(errorDiv);

    // Remove old container and append new one
    const oldContainer = postContainer.querySelector('.wingman-results-container');
    if (oldContainer) oldContainer.remove();
    
    postContainer.appendChild(resultsContainer);
    resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    
    // Reset button
    const btn = postContainer.querySelector('.wingman-btn');
    if (btn) {
        btn.classList.remove('loading');
        btn.innerHTML = '<span class="wingman-btn-icon">✨</span> Wingman';
    }
}

// Listener for direct messages from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Wingman LinkedIn: Received message:", request.action);
    if (request.action === 'show_results') {
        console.log("Wingman LinkedIn: Direct delivery received! Text length:", request.results?.length, "target:", request.targetNodeId);
        stopPolling(); // Stop polling since we got direct delivery
        renderResults(request.targetNodeId, request.results);
        sendResponse({ status: 'received' });
    }
    return true;
});

// Setup Mutation Observer to watch for feed scrolling
const observer = new MutationObserver((_mutations) => {
    try {
        injectWingmanButtons();
    } catch (e) {
        console.error("Wingman: error injecting buttons", e);
    }
});

// Start observing when DOM is somewhat ready
setTimeout(() => {
    observer.observe(document.body, { childList: true, subtree: true });
    injectWingmanButtons();
}, 2000);
