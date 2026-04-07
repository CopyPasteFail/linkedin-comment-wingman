// Set to true to use a simplified prompt for rapid extraction testing
const TEST_MODE = true;

const PROMPT_INSTRUCTIONS = TEST_MODE ? `
Return exactly 8 options in this format:
option 1
\`\`\`text
Short test comment 1
\`\`\`
option 2
\`\`\`text
Short test comment 2
\`\`\`
...and so on up to option 8. 
ONLY return the options. No other text.
---
HERE IS THE LINKEDIN POST:
` : `
# Role
Write short LinkedIn comments for posts about AI, innovation, startups, product, infrastructure, and technology.
... (rest of the detailed prompt)
`;

// Use chrome.storage.session to persist activeTask across service worker restarts
async function getActiveTask() {
  const data = await chrome.storage.session.get('activeTask');
  return data.activeTask || null;
}

async function setActiveTask(task) {
  await chrome.storage.session.set({ activeTask: task });
}

async function clearActiveTask() {
  await chrome.storage.session.remove('activeTask');
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'generate_comments') {
    console.log("Wingman BG: Received generate_comments request");
    
    const fullPrompt = PROMPT_INSTRUCTIONS + "\n" + request.postText;
    
    chrome.windows.create({
      url: 'https://chatgpt.com/?model=gpt-4',
      type: 'popup',
      width: 500,
      height: 700,
      focused: false,
      state: 'normal'
    }, async (window) => {
      const task = {
        windowId: window.id,
        tabId: window.tabs[0].id,
        prompt: fullPrompt,
        senderTabId: sender.tab.id,
        targetNodeId: request.targetNodeId
      };
      await setActiveTask(task);
      console.log("Wingman BG: Task stored. ChatGPT tab:", task.tabId, "LinkedIn tab:", task.senderTabId);
      sendResponse({ status: 'started' });
    });
    
    return true; // async response
  }
  
  if (request.action === 'chatgpt_ready') {
    console.log("Wingman BG: ChatGPT says it's ready, tab:", sender.tab.id);
    
    getActiveTask().then(activeTask => {
      if (activeTask && activeTask.tabId === sender.tab.id) {
        console.log("Wingman BG: Sending prompt to ChatGPT, length:", activeTask.prompt.length);
        sendResponse({ action: 'process_prompt', prompt: activeTask.prompt });
      } else {
        console.log("Wingman BG: No matching task for this tab");
        sendResponse({ action: 'idle' });
      }
    });
    
    return true; // async response
  }
  
  if (request.action === 'chatgpt_result') {
    console.log("Wingman BG: Received result from ChatGPT, length:", request.text?.length);
    
    getActiveTask().then(async activeTask => {
      if (activeTask && activeTask.tabId === sender.tab.id) {
        console.log("Wingman BG: Processing result for LinkedIn tab:", activeTask.senderTabId, "targetNode:", activeTask.targetNodeId);
        
        // ALWAYS store result in chrome.storage.local as backup delivery channel
        // The LinkedIn content script polls this, so even if messaging fails, it will get the results
        const pendingResult = {
          results: request.text,
          targetNodeId: activeTask.targetNodeId,
          timestamp: Date.now()
        };
        await chrome.storage.local.set({ wingmanPendingResult: pendingResult });
        console.log("Wingman BG: Result stored in chrome.storage.local as backup");
        
        // Attempt direct delivery via messaging
        let sendSuccess = false;
        try {
          const response = await chrome.tabs.sendMessage(activeTask.senderTabId, {
            action: 'show_results',
            results: request.text,
            targetNodeId: activeTask.targetNodeId
          });
          console.log("Wingman BG: Direct message delivery succeeded, response:", response);
          sendSuccess = true;
          // Clear storage since direct delivery worked
          await chrome.storage.local.remove('wingmanPendingResult');
        } catch (err) {
          console.warn("Wingman BG: Direct message failed:", err.message);
          console.log("Wingman BG: Result remains in storage for polling pickup");
        }
        
        sendResponse({ status: sendSuccess ? 'delivered' : 'stored_for_pickup' });
        
        // Close the ChatGPT window ONLY if it was a success message (not an Error)
        if (!request.text.startsWith('Error:')) {
            try {
                await chrome.windows.remove(activeTask.windowId);
                console.log("Wingman BG: Window closed after success.");
            } catch (_err) {
                console.log("Wingman BG: Window already closed");
            }
        } else {
            console.log("Wingman BG: Keeping window open for debugging since an error occurred.");
        }
        
        await clearActiveTask();
      } else {
        console.error("Wingman BG: No matching active task for result");
        sendResponse({ status: 'error', error: 'no matching task' });
      }
    });
    
    return true; // async response
  }
  
  // LinkedIn content script checking for pending results (polling fallback)
  if (request.action === 'check_pending_result') {
    chrome.storage.local.get('wingmanPendingResult', (data) => {
      if (data.wingmanPendingResult) {
        console.log("Wingman BG: Delivering pending result via polling");
        sendResponse({ hasPending: true, ...data.wingmanPendingResult });
        // Clear after delivery
        chrome.storage.local.remove('wingmanPendingResult');
      } else {
        sendResponse({ hasPending: false });
      }
    });
    return true;
  }
});
