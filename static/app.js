// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let hwData = null;
let modelsData = null;

// Tour state
let tourOpen = false;
let selectedTime = 30;
let selectedLevel = 200;
let lessonPlan = null;
let currentLessonIndex = -1;
let completedLessons = new Set();
let profChatHistory = [];
let profStreaming = false;
let selectedModel = null;
let foundryOnline = false;

// ---------------------------------------------------------------------------
// Navigation (normal app)
// ---------------------------------------------------------------------------
function navigateTo(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const el = document.getElementById(`page-${page}`);
    if (el) el.classList.add('active');
    const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (nav) nav.classList.add('active');

    if (page === 'hardware' && !hwData) loadHardware();
    if (page === 'models' && !modelsData) loadModels();
}

// ---------------------------------------------------------------------------
// Hardware Detection
// ---------------------------------------------------------------------------
async function loadHardware() {
    try {
        const resp = await fetch('/api/hardware');
        hwData = await resp.json();
        renderHardware(hwData);
    } catch (e) {
        console.error('Failed to load hardware:', e);
    }
}

function renderHardware(hw) {
    document.getElementById('hw-loading').style.display = 'none';
    document.getElementById('hw-results').style.display = 'block';

    document.getElementById('cpuName').textContent = hw.cpu.name;
    document.getElementById('cpuArch').textContent = `${hw.cpu.vendor} · ${hw.cpu.architecture}`;

    document.getElementById('gpuName').textContent = hw.gpu.name;
    const gpuBadge = document.getElementById('gpuBadge');
    if (hw.gpu.detected) {
        gpuBadge.textContent = '✓ Detected';
        gpuBadge.className = 'hw-badge badge-active';
    } else {
        gpuBadge.textContent = '✗ Not found';
        gpuBadge.className = 'hw-badge badge-inactive';
    }

    document.getElementById('npuName').textContent = hw.npu.name;
    document.getElementById('npuStatus').textContent = hw.npu.status === 'Started' ? 'Running' : hw.npu.status;
    const npuBadge = document.getElementById('npuBadge');
    if (hw.npu.detected) {
        npuBadge.textContent = '✓ Active';
        npuBadge.className = 'hw-badge badge-active';
        document.getElementById('npuInfoCard').style.display = 'block';
    } else {
        npuBadge.textContent = '✗ Not found';
        npuBadge.className = 'hw-badge badge-inactive';
        document.getElementById('noNpuCard').style.display = 'block';
    }

    document.getElementById('vendorName').textContent = `${hw.summary.silicon_vendor} Silicon`;
    document.getElementById('ramInfo').textContent = `${hw.ram_gb} GB RAM`;
}

// ---------------------------------------------------------------------------
// Model Recommendations
// ---------------------------------------------------------------------------
async function loadModels() {
    try {
        const resp = await fetch('/api/models');
        modelsData = await resp.json();
        renderModels(modelsData);
    } catch (e) {
        console.error('Failed to load models:', e);
    }
}

function renderModels(data) {
    document.getElementById('models-loading').style.display = 'none';
    document.getElementById('models-results').style.display = 'block';
    const grid = document.getElementById('recGrid');
    grid.innerHTML = '';

    const recs = data.recommendations;
    for (const [key, rec] of Object.entries(recs)) {
        if (!rec.top_pick) continue;
        const card = document.createElement('div');
        card.className = 'rec-card';

        const altsHtml = rec.alternatives.length > 0
            ? `<div class="rec-alts">Also consider: ${rec.alternatives.map(a =>
                `<span>${a.alias}</span> (${a.device})`).join(', ')}</div>`
            : '';

        const deviceClass = rec.top_pick.device.toLowerCase();

        card.innerHTML = `
            <div class="rec-task">
                <span class="task-icon">${rec.icon}</span>
                ${rec.label}
            </div>
            <div class="rec-model">
                <div class="rec-model-name">
                    ${rec.top_pick.alias}
                    <span class="device-tag ${deviceClass}">${rec.top_pick.device}</span>
                </div>
                <div class="rec-model-desc">${rec.top_pick.description}</div>
                <div class="rec-model-meta">
                    <span>📦 ${rec.top_pick.size_gb} GB</span>
                    <span>⚡ Speed: ${rec.top_pick.speed}/10</span>
                    <span>🎯 Quality: ${rec.top_pick.quality}/10</span>
                </div>
            </div>
            ${altsHtml}
        `;
        grid.appendChild(card);
    }
}

// ---------------------------------------------------------------------------
// Foundry Status
// ---------------------------------------------------------------------------
async function loadFoundryStatus() {
    try {
        const resp = await fetch('/api/foundry/status');
        const status = await resp.json();
        updateFoundryUI(status);
    } catch (e) {
        updateFoundryUI({ status: 'error' });
    }
}

function updateFoundryUI(status) {
    const dot = document.getElementById('foundryDot');
    const text = document.getElementById('foundryStatusText');

    if (status.status === 'online') {
        dot.classList.add('online');
        text.textContent = 'Foundry Local Online';
        foundryOnline = true;

        const preferred = [
            'Phi-4-mini-instruct-generic-cpu:5',
            'qwen2.5-7b-instruct-qnn-npu:2',
            'phi-3.5-mini-instruct-qnn-npu:2',
            'qwen2.5-0.5b-instruct-generic-cpu:4',
        ];
        const loaded = status.loaded_models || [];
        selectedModel = preferred.find(m => loaded.includes(m)) || loaded[0] || preferred[0];
    } else {
        dot.classList.remove('online');
        text.textContent = status.status === 'offline' ? 'Foundry Offline' : 'Foundry Error';
        foundryOnline = false;
    }
}

// ---------------------------------------------------------------------------
// Tour Overlay — Open / Close
// ---------------------------------------------------------------------------
function openTourSetup() {
    const overlay = document.getElementById('tourOverlay');
    overlay.classList.add('open');
    tourOpen = true;

    // Always show setup, hide active tour
    document.getElementById('tourSetupScreen').style.display = 'flex';
    document.getElementById('tourActive').style.display = 'none';
}

function closeTour() {
    const overlay = document.getElementById('tourOverlay');
    overlay.classList.remove('open');
    tourOpen = false;
}

// ---------------------------------------------------------------------------
// Tour Setup — Time & Level Selection
// ---------------------------------------------------------------------------
function selectTime(t) {
    selectedTime = t;
    document.querySelectorAll('.time-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.textContent) === t);
    });
}

function selectLevel(l) {
    selectedLevel = l;
    document.querySelectorAll('.level-btn').forEach(b => {
        const val = parseInt(b.querySelector('strong').textContent);
        b.classList.toggle('active', val === l);
    });
}

// ---------------------------------------------------------------------------
// Build Lesson Plan & Activate Tour
// ---------------------------------------------------------------------------
async function buildLessonPlan() {
    try {
        const resp = await fetch('/api/lesson-plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ level: selectedLevel, time_minutes: selectedTime }),
        });
        const data = await resp.json();
        lessonPlan = data;
        currentLessonIndex = -1;
        completedLessons = new Set();
        profChatHistory = [];

        // Switch to active tour view
        document.getElementById('tourSetupScreen').style.display = 'none';
        document.getElementById('tourActive').style.display = 'grid';

        renderLessonPlan(data);
    } catch (e) {
        console.error('Failed to build lesson plan:', e);
    }
}

function renderLessonPlan(data) {
    const levelNames = { 100: 'Intro', 200: 'Fundamentals', 300: 'Intermediate', 400: 'Advanced' };
    document.getElementById('planLevel').textContent = `${data.level} — ${levelNames[data.level] || ''}`;
    document.getElementById('planTime').textContent = `${data.total_minutes} min`;
    updateProgress();

    // Render lesson list
    const container = document.getElementById('planLessons');
    container.innerHTML = '';

    data.plan.forEach((lesson, i) => {
        const item = document.createElement('div');
        item.className = 'lesson-item';
        item.id = `lesson-${i}`;
        item.onclick = () => startLesson(i);
        item.innerHTML = `
            <span class="lesson-icon">${lesson.icon}</span>
            <div class="lesson-info">
                <div class="lesson-name">${lesson.lesson_title}</div>
                <div class="lesson-meta">${lesson.title} · ${lesson.duration} min</div>
            </div>
            <div class="lesson-check" id="check-${i}" onclick="event.stopPropagation(); completeLesson(${i})" title="Mark complete"></div>
        `;
        container.appendChild(item);
    });

    // Welcome message
    const messages = document.getElementById('profMessages');
    messages.innerHTML = '';
    const planSummary = data.plan.map(l => l.lesson_title).join(', ');
    appendProfMessage('professor',
        `📋 Your lesson plan is ready! <strong>${data.plan.length} lessons</strong> covering: ${planSummary}. ` +
        `Click any lesson on the left to begin — the content will load in the centre and I'll guide you here. Let's learn! 🎓`
    );

    // Auto-start first lesson
    if (data.plan.length > 0) {
        startLesson(0);
    }
}

function updateProgress() {
    if (!lessonPlan) return;
    const total = lessonPlan.plan.length;
    const done = completedLessons.size;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    document.getElementById('planProgress').textContent = `${done} / ${total} lessons complete`;
    document.getElementById('tourProgressFill').style.width = `${pct}%`;
}

// ---------------------------------------------------------------------------
// Lesson Navigation (renders page content into the tour centre panel)
// ---------------------------------------------------------------------------
function startLesson(index) {
    if (!lessonPlan || index >= lessonPlan.plan.length) return;

    currentLessonIndex = index;

    // Highlight active lesson
    document.querySelectorAll('.lesson-item').forEach((el, i) => {
        el.classList.toggle('active', i === index);
    });

    const lesson = lessonPlan.plan[index];

    // Clone the page content into the tour centre panel
    const sourcePage = document.getElementById(`page-${lesson.page}`);
    const target = document.getElementById('tourContentInner');
    if (sourcePage && target) {
        target.innerHTML = '';
        const clone = sourcePage.cloneNode(true);
        clone.classList.add('active');
        clone.style.display = 'block';
        // Re-enable copy buttons in cloned content
        clone.querySelectorAll('.copy-btn').forEach(btn => {
            btn.onclick = () => copyCmd(btn);
        });
        target.appendChild(clone);

        // If it's hardware page and we have data, re-render in clone
        if (lesson.page === 'hardware' && hwData) {
            renderHardwareInElement(clone, hwData);
        }

        // Scroll to top
        document.getElementById('tourContent').scrollTop = 0;
    }

    // Also update the underlying app navigation (for data loading)
    navigateTo(lesson.page);

    // Show teaching intro
    const intro = LESSON_INTROS[lesson.topic]?.[lesson.level];
    if (intro) {
        appendProfMessage('professor', intro);
    } else {
        appendProfMessage('professor',
            `📖 Now studying: <strong>${lesson.lesson_title}</strong>. ` +
            `Read through the content in the centre panel. Ask me anything!`
        );
    }
}

function renderHardwareInElement(el, hw) {
    const set = (id, text) => { const e = el.querySelector(`#${id}`); if (e) e.textContent = text; };
    const loading = el.querySelector('#hw-loading');
    const results = el.querySelector('#hw-results');
    if (loading) loading.style.display = 'none';
    if (results) results.style.display = 'block';

    set('cpuName', hw.cpu.name);
    set('cpuArch', `${hw.cpu.vendor} · ${hw.cpu.architecture}`);
    set('gpuName', hw.gpu.name);
    set('npuName', hw.npu.name);
    set('npuStatus', hw.npu.status === 'Started' ? 'Running' : hw.npu.status);
    set('vendorName', `${hw.summary.silicon_vendor} Silicon`);
    set('ramInfo', `${hw.ram_gb} GB RAM`);

    const gpuBadge = el.querySelector('#gpuBadge');
    if (gpuBadge) {
        gpuBadge.textContent = hw.gpu.detected ? '✓ Detected' : '✗ Not found';
        gpuBadge.className = `hw-badge ${hw.gpu.detected ? 'badge-active' : 'badge-inactive'}`;
    }
    const npuBadge = el.querySelector('#npuBadge');
    if (npuBadge) {
        npuBadge.textContent = hw.npu.detected ? '✓ Active' : '✗ Not found';
        npuBadge.className = `hw-badge ${hw.npu.detected ? 'badge-active' : 'badge-inactive'}`;
    }
    const npuCard = el.querySelector('#npuInfoCard');
    const noNpuCard = el.querySelector('#noNpuCard');
    if (hw.npu.detected) {
        if (npuCard) npuCard.style.display = 'block';
    } else {
        if (noNpuCard) noNpuCard.style.display = 'block';
    }
}

function completeLesson(index) {
    completedLessons.add(index);
    const item = document.getElementById(`lesson-${index}`);
    const check = document.getElementById(`check-${index}`);

    if (item) item.classList.add('completed');
    if (check) {
        check.classList.add('done');
        check.textContent = '✓';
    }

    updateProgress();

    const nextIndex = lessonPlan.plan.findIndex((_, i) => i > index && !completedLessons.has(i));

    if (completedLessons.size === lessonPlan.plan.length) {
        appendProfMessage('professor',
            `🎉 <strong>Congratulations!</strong> You've completed all ${lessonPlan.plan.length} lessons! ` +
            `You're now a Level ${lessonPlan.level} NPU scholar. Click "← New Plan" to try a higher level, ` +
            `or exit the tour to explore freely.`
        );
    } else if (nextIndex >= 0) {
        const next = lessonPlan.plan[nextIndex];
        appendProfMessage('professor',
            `✅ Great work! Ready for the next one? Click <strong>${next.lesson_title}</strong> to continue.`
        );
    }
}

function resetPlan() {
    lessonPlan = null;
    currentLessonIndex = -1;
    completedLessons = new Set();
    profChatHistory = [];

    document.getElementById('tourSetupScreen').style.display = 'flex';
    document.getElementById('tourActive').style.display = 'none';
}

// ---------------------------------------------------------------------------
// Professor Chat (streaming)
// ---------------------------------------------------------------------------
async function sendProfMessage() {
    const input = document.getElementById('profInput');
    const text = input.value.trim();
    if (!text || profStreaming) return;

    input.value = '';
    appendProfMessage('student', escapeHtml(text));
    profChatHistory.push({ role: 'user', content: text });

    if (!foundryOnline || !selectedModel) {
        appendProfMessage('professor',
            '⚠️ Foundry Local is not running. Start it with <code>foundry service start</code> to enable chat. ' +
            'You can still navigate lessons and read the content!'
        );
        return;
    }

    profStreaming = true;
    const typingEl = appendProfTyping();

    try {
        const contextMessages = [];
        if (lessonPlan && currentLessonIndex >= 0) {
            const lesson = lessonPlan.plan[currentLessonIndex];
            contextMessages.push({
                role: 'system',
                content: `The student is currently on lesson: "${lesson.lesson_title}" (${lesson.title}, Level ${lesson.level}). ${lesson.summary}. Tailor your response to this context and level.`
            });
        }

        const resp = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: [...contextMessages, ...profChatHistory],
                model: selectedModel,
            }),
        });

        typingEl.remove();

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let content = '';
        let bubbleEl = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') break;

                try {
                    const parsed = JSON.parse(data);
                    const delta = parsed.choices?.[0]?.delta?.content;
                    if (delta) {
                        if (!bubbleEl) {
                            bubbleEl = appendProfMessage('professor', '');
                        }
                        content += delta;
                        bubbleEl.innerHTML = renderMarkdown(content);
                        scrollProfChat();
                    }
                } catch {}
            }
        }

        if (content) {
            profChatHistory.push({ role: 'assistant', content });
        }
    } catch (e) {
        typingEl?.remove();
        appendProfMessage('professor', `⚠️ Error: ${e.message}`);
    }

    profStreaming = false;
}

function appendProfMessage(role, content) {
    const container = document.getElementById('profMessages');
    const msg = document.createElement('div');
    msg.className = `prof-msg ${role}`;
    msg.innerHTML = content;
    container.appendChild(msg);
    scrollProfChat();
    return msg;
}

function appendProfTyping() {
    const container = document.getElementById('profMessages');
    const msg = document.createElement('div');
    msg.className = 'prof-msg professor';
    msg.innerHTML = '<div class="prof-typing"><span></span><span></span><span></span></div>';
    container.appendChild(msg);
    scrollProfChat();
    return msg;
}

function scrollProfChat() {
    const container = document.getElementById('profMessages');
    container.scrollTop = container.scrollHeight;
}

// ---------------------------------------------------------------------------
// Lesson Teaching Intros
// ---------------------------------------------------------------------------
const LESSON_INTROS = {
    hardware: {
        100: "🔍 Welcome to your first lesson! Take a look at the hardware cards. Every PC has a CPU, and many have a GPU. What makes your Copilot+ PC special is the <strong>NPU</strong> — a chip designed specifically for AI tasks. Think of it as a tiny dedicated brain for machine learning!",
        200: "🔍 Let's understand your AI hardware. The key insight: <strong>NPUs are energy-efficient AI accelerators</strong>. While your CPU handles ~10 TOPS, your NPU delivers 40+ TOPS at a fraction of the power. This is why always-on AI features use the NPU — it doesn't drain your battery.",
        300: "🔍 Time to go deeper. Understanding <strong>TOPS</strong> (Trillion Operations Per Second) and execution providers (QNN for Qualcomm, OpenVINO for Intel) helps you select the right model formats. Notice how NPU models use QNN quantization — optimized for the Hexagon DSP.",
        400: "🔍 Advanced hardware analysis. Pay attention to <strong>memory bandwidth</strong> — it constrains model loading time and token generation speed. Your hardware profile determines the upper bound of model size. NPU models are quantized to INT4/INT8 for Hexagon's SIMD units."
    },
    foundry: {
        100: "🏗️ <strong>Foundry Local</strong> is Microsoft's runtime for running AI models entirely on your device — no cloud, no internet needed. Think of it as a local AI server that speaks the same language as OpenAI's API. Let's see how it works!",
        200: "🏗️ Time to get hands-on! Follow the installation steps on this page. The key commands are <code>foundry service start</code> and <code>foundry model run phi-4-mini</code>. Try running your first model today!",
        300: "🏗️ Now we're building real apps. The API at <code>/v1/chat/completions</code> is OpenAI-compatible — meaning any code written for GPT-4 can work with local models by just changing the base URL. Check out the Python and C# examples!",
        400: "🏗️ Production architecture time. Key patterns: service discovery via <code>foundry service status</code> (port is dynamic), model caching with <code>--retain</code>, and the tradeoff between NPU (efficiency) and CPU (compatibility) execution providers."
    },
    models: {
        100: "🤖 <strong>SLMs</strong> (Small Language Models) are AI models compact enough to run right on your device. They range from tiny (0.5B parameters) to medium (14B+). Smaller = faster, larger = smarter. Let's find the right balance!",
        200: "🤖 The recommendations here are tailored to your hardware. Notice each model has <strong>speed</strong> and <strong>quality</strong> ratings. For quick tasks, pick high-speed models. For complex reasoning, prioritize quality.",
        300: "🤖 Let's talk formats. <strong>ONNX</strong> is the universal model format. <strong>QNN</strong> models are Qualcomm-optimized for NPU. <strong>GGUF</strong> is popular for CPU inference. The quantization level (INT4, INT8, FP16) trades quality for speed.",
        400: "🤖 Systematic evaluation matters. Compare models on: latency (time to first token), throughput (tokens/sec), quality (task-specific benchmarks), and memory footprint. Use AI Toolkit's batch inference to benchmark across your actual use cases."
    },
    toolkit: {
        100: "🧰 <strong>AI Toolkit</strong> is a VS Code extension that makes model development visual and accessible. Browse models, test prompts, and even fine-tune — all from your editor!",
        200: "🧰 The <strong>Model Playground</strong> is your experimentation lab. Load any local model, adjust temperature and max tokens, and compare outputs side-by-side. Great for finding the right model for your task!",
        300: "🧰 <strong>LoRA fine-tuning</strong> lets you customize a model with your own data using minimal resources. QLoRA goes further with 4-bit quantization. AI Toolkit handles the complex setup — you just provide your dataset.",
        400: "🧰 Advanced workflows: export fine-tuned models to <strong>ONNX</strong> for cross-platform deployment, run batch inference for systematic evaluation, and integrate with Foundry Local for production serving."
    },
    recall: {
        100: "🔄 <strong>Recall</strong> is like photographic memory for your PC. It periodically captures what's on screen and makes it searchable with natural language. Ask 'that email about the deadline' and find it instantly!",
        200: "🔄 Let's get Recall set up. Follow the steps here. Key requirements: Copilot+ PC with NPU (40+ TOPS), 16GB+ RAM, and BitLocker enabled. Everything is encrypted with Windows Hello.",
        300: "🔄 Under the hood: the NPU runs <strong>OCR</strong> on each snapshot (extracting text) and generates <strong>semantic embeddings</strong> (capturing meaning). This dual indexing enables both keyword and natural language search.",
        400: "🔄 For developers: Recall's architecture demonstrates the power of <strong>always-on NPU processing</strong>. The NPU handles continuous OCR+embedding generation with minimal battery impact — a pattern you can replicate in your own apps."
    },
    clicktodo: {
        100: "👆 <strong>Click to Do</strong> is like having an AI assistant that can see your screen. Point at any text, image, or UI element, and it suggests smart actions — summarize, edit, search, and more!",
        200: "👆 Try it now! Press <strong>Win + Mouse Click</strong> to activate. The NPU analyzes what you're pointing at in real-time. Select text for summaries, images for editing, links for context actions.",
        300: "👆 Customize your workflow: configure default actions per content type, exclude certain apps, and chain actions together. Click to Do works across <em>any</em> application because it operates on screen pixels, not app APIs.",
        400: "👆 The screen understanding pipeline: <strong>NPU vision models</strong> segment the screen into regions, classify content types, then run specialized models (OCR for text, image classifiers for visuals). All in real-time, all on-device."
    },
    semanticsearch: {
        100: "🔎 <strong>Semantic Search</strong> upgrades Windows Search with AI understanding. Instead of matching exact filenames, it understands what you <em>mean</em>. Search 'vacation plans' to find 'summer-trip-itinerary.docx'!",
        200: "🔎 Tips for better results: use natural, descriptive phrases instead of keywords. 'Notes from last week's design review' works better than 'meeting notes'. The AI understands context and meaning!",
        300: "🔎 How it works: the NPU generates <strong>384-dimensional embedding vectors</strong> for your files. When you search, your query is also embedded, and results are ranked by <strong>cosine similarity</strong> — closeness in meaning-space.",
        400: "🔎 Build your own: the Windows Copilot Runtime <strong>TextEmbedding API</strong> lets you generate embeddings locally using the NPU. Combine with vector databases like FAISS or ChromaDB for custom RAG applications — all running locally!"
    },
};

// ---------------------------------------------------------------------------
// Markdown Rendering (lightweight)
// ---------------------------------------------------------------------------
function renderMarkdown(text) {
    let html = escapeHtml(text);
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
        `<pre><code>${code.trim()}</code></pre>`);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    html = html.replace(/\n{2,}/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    if (!html.startsWith('<')) html = `<p>${html}</p>`;
    return html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function copyCmd(btn) {
    const block = btn.parentElement;
    const text = block.childNodes[0]?.textContent?.trim() ||
                 block.querySelector('pre')?.textContent?.trim() ||
                 block.textContent.replace('Copy', '').trim();
    navigator.clipboard.writeText(text).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy', 1500);
    });
}

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------
loadHardware();
loadFoundryStatus();
