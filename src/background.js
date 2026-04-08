const backgroundUtils = globalThis.WingmanBackgroundUtils || {
  getChatGptPopupOptions() {
    return {
      url: "https://chatgpt.com/?model=gpt-4",
      type: "popup",
      width: 500,
      height: 700,
      focused: false,
      state: "normal"
    };
  },
  createActiveTaskFromWindow(createdWindow, prompt, senderTabId, targetNodeId) {
    const createdTab = createdWindow?.tabs?.[0];
    if (!createdWindow?.id || !createdTab?.id) {
      return null;
    }

    return {
      windowId: createdWindow.id,
      tabId: createdTab.id,
      prompt,
      senderTabId,
      targetNodeId
    };
  }
};
const getChatGptPopupOptions = backgroundUtils.getChatGptPopupOptions;
const createActiveTaskFromWindow = backgroundUtils.createActiveTaskFromWindow;

const PROMPT_INSTRUCTIONS = `# Role
Write short LinkedIn comments for posts about AI, innovation, startups, product, infrastructure, and technology.


# Core objective
Create comments that feel human, sharp, and conversational while increasing the chance of profile clicks and impressions.

Comments should feel interesting enough
that someone might click the profile out of curiosity.


# Tone

Write in English unless the user explicitly asks for another language.

Use a natural, human tone.

Depending on the post and the specific comment, it may be:
- casual
- thoughtful
- witty
- technical
- conversational
- reflective
- confident when relevant
- playful when appropriate
- serious when appropriate


# Core comment strategy

Each comment should do at least one of these:

- add a real point of view
- validate the post in a specific way
- react in a human, conversational way
- hint at real experience
- extend the idea slightly
- show curiosity or reflection

Avoid generic reactions.


# Specificity rule

Each comment must reference something concrete from the post.

This can be:
- a concept
- an example
- a claim
- a situation
- a technology
- an analogy
- a problem mentioned

Do not write vague praise.


# Builder / operator credibility

At least two comments must naturally imply real hands-on experience
with building, operating, testing, or debugging real systems.

When relevant, the comment may sound like it comes from someone
who ships things and deals with production reality,
not someone who only talks about them.

Mentioning your own experience is allowed when it adds context,
including what you built, tested, ran into, or saw in production.

This should feel implicit, practical, and conversational,
not like repeating stock phrases or trying to impress.

lightly promotional is allowed when earned by hands-on context (never salesy)

Do not sell.
Do not pitch.
Do not call to action.

It should feel like context, not promotion.


# Ecosystem lens

When natural, extend the idea in the post into a broader pattern
seen across teams building real products or systems.

This can relate to tooling, infrastructure,
developer workflows, production reality,
or how the field is evolving.

Do not force this in every comment.

Do not repeat the same type of observation.


# Emotional matching rule

Match the tone of the post when appropriate.

If the post feels personal → allow warmer tone  
If the post feels technical → allow operator tone  
If the post feels excited → allow energy  
If the post feels frustrated → allow realism  
If the post feels reflective → allow thoughtful tone  
If the post feels playful → allow humor  

Do not force humor.
Do not force seriousness.


# Conversational naturalness

Comments should sometimes feel like real quick replies.

Some comments may use conversational wording
when it feels natural.

Allowed:
- informal phrasing
- shortened wording
- chat-like rhythm
- short sentences
- fragments
- slightly imperfect conversational flow

Not every comment should use this.

Avoid repeating the same expressions across options.

Not allowed:
- bad grammar
- unreadable slang
- childish tone


# Humor rule

When humor fits the post, keep it:
- dry
- subtle
- ironic
- lightly sarcastic
- builder-style when relevant

Avoid forced jokes.
Avoid meme tone.
Avoid emoji spam.


# Style variation rule

All comments come from one pool.

Do not split into style groups.

Across the comments, vary naturally in:
- rhythm
- personality
- emotional level
- humor level
- technical depth
- formality
- perspective

The comments must not feel like rewrites of the same sentence.


# Output count

Return 8 options.


# Writing rules

For each comment:

- 1 to 3 sentences
- always use line breaks instead of periods
- periods may be used only if necessary for readability
- maximum 1 emoji
- only the first sentence may start with a capital letter
- keep the rest lowercase unless capitalization is required


# Output format

Return exactly this structure:

option 1
\`\`\`text
<comment>
\`\`\`

option 2
\`\`\`text
<comment>
\`\`\`

option 3
\`\`\`text
<comment>
\`\`\`

option 4
\`\`\`text
<comment>
\`\`\`

option 5
\`\`\`text
<comment>
\`\`\`

option 6
\`\`\`text
<comment>
\`\`\`

option 7
\`\`\`text
<comment>
\`\`\`

option 8
\`\`\`text
<comment>
\`\`\`

...and so on up to option 8. 
ONLY return the options. No other text.


Formatting rules:

- label outside code block
- only the comment inside
- preserve line breaks
- no extra text


# Quality standard

The result should feel like something a smart,
technically credible person would actually write quickly on LinkedIn.

The writing should feel:
- natural
- specific
- slightly opinionated
- human
- not corporate
- not polished
- not robotic

---
HERE IS THE LINKEDIN POST:
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

    chrome.windows.create(getChatGptPopupOptions(), async (createdWindow) => {
      if (chrome.runtime.lastError) {
        console.error("Wingman BG: Failed to open ChatGPT popup:", chrome.runtime.lastError.message);
        sendResponse({ status: 'error', error: chrome.runtime.lastError.message });
        return;
      }

      const task = createActiveTaskFromWindow(
        createdWindow,
        fullPrompt,
        sender.tab?.id,
        request.targetNodeId
      );

      if (!task) {
        console.error("Wingman BG: Popup opened without a usable tab.");
        sendResponse({ status: 'error', error: 'ChatGPT popup opened without a usable tab.' });
        return;
      }

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
