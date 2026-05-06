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
// Sidebar Toggle
// ---------------------------------------------------------------------------
function toggleSidebar() {
    document.querySelector('.app-shell').classList.toggle('sidebar-collapsed');
}

// ---------------------------------------------------------------------------
// Industry Scenario Drill-Down
// ---------------------------------------------------------------------------
function showIndustryDetail(id) {
    document.getElementById('industry-pills').style.display = 'none';
    document.querySelectorAll('.industry-detail').forEach(d => d.style.display = 'none');
    document.getElementById('detail-' + id).style.display = 'block';
    document.getElementById('industry-back-btn').style.display = 'inline-flex';
}

function showIndustryPills() {
    document.querySelectorAll('.industry-detail').forEach(d => d.style.display = 'none');
    document.getElementById('industry-back-btn').style.display = 'none';
    document.getElementById('industry-pills').style.display = 'grid';
}

// ---------------------------------------------------------------------------
// Navigation (normal app)
// ---------------------------------------------------------------------------
function navigateTo(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const el = document.getElementById(`page-${page}`);
    if (el) el.classList.add('active');
    const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (nav) {
        nav.classList.add('active');
        // Auto-expand the parent section if collapsed
        const section = nav.closest('.nav-section-items');
        if (section && !section.classList.contains('open')) {
            section.classList.add('open');
            section.previousElementSibling?.classList.add('open');
        }
    }

    if (page === 'hardware' && !hwData) loadHardware();
    if (page === 'models' && !modelsData) loadModels();
}

function toggleNavSection(label) {
    label.classList.toggle('open');
    const items = label.nextElementSibling;
    if (items && items.classList.contains('nav-section-items')) {
        items.classList.toggle('open');
    }
}

function toggleNavSubsection(label) {
    label.classList.toggle('open');
    const items = label.nextElementSibling;
    if (items && items.classList.contains('nav-subsection-items')) {
        items.classList.toggle('open');
    }
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

        // Vendor-specific NPU tip
        const vendor = hw.summary.silicon_vendor;
        const tipEl = document.getElementById('npuVendorTip');
        if (vendor === 'Intel') {
            tipEl.innerHTML = 'Your <strong>Intel AI Boost</strong> NPU uses the <strong>OpenVINO™</strong> execution provider ' +
                'for optimized inference. In Foundry Local, look for models tagged with <code>-ov-npu</code> or use CPU models ' +
                'with <code>-generic-cpu</code>. Install OpenVINO via <code>pip install openvino</code> for direct NPU development.';
        } else if (vendor === 'Qualcomm') {
            tipEl.innerHTML = 'Your <strong>Qualcomm Hexagon</strong> NPU uses the <strong>QNN (Qualcomm Neural Network)</strong> ' +
                'execution provider, specifically optimized for the Hexagon processor in your Snapdragon chip. ' +
                'In Foundry Local, look for models tagged with <code>-qnn-npu</code>. Use ' +
                '<a href="https://aihub.qualcomm.com" target="_blank" style="color:var(--accent)">Qualcomm AI Hub</a> to optimize custom models.';
        } else {
            tipEl.innerHTML = 'Your NPU is detected and ready for AI inference via Windows ML and DirectML.';
        }

        // Show deep dive section with vendor-specific content
        document.getElementById('npuDeepDive').style.display = 'block';
        if (vendor === 'Intel') {
            document.getElementById('npuDeepDiveIntel').style.display = 'block';
        } else if (vendor === 'Qualcomm') {
            document.getElementById('npuDeepDiveQualcomm').style.display = 'block';
        }
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

        const vendor = hwData?.summary?.silicon_vendor || '';
        const loaded = status.loaded_models || [];

        // Vendor-aware model preference
        let preferred;
        if (vendor === 'Qualcomm') {
            preferred = [
                'qwen2.5-7b-instruct-qnn-npu:2',
                'phi-3.5-mini-instruct-qnn-npu:2',
                'qwen2.5-0.5b-instruct-generic-cpu:4',
            ];
        } else {
            // Intel (default)
            preferred = [
                'phi-4-mini-instruct-openvino-npu:3',
                'phi-4-mini-instruct-generic-cpu:5',
                'phi-3.5-mini-instruct-openvino-npu:2',
                'qwen2.5-0.5b-instruct-generic-cpu:4',
            ];
        }
        selectedModel = preferred.find(m => loaded.includes(m)) || loaded[0] || preferred[0];
        updateModelIndicator();
    } else {
        dot.classList.remove('online');
        text.textContent = status.status === 'offline' ? 'Foundry Offline' : 'Foundry Error';
        foundryOnline = false;
        updateModelIndicator();
    }
}

function updateModelIndicator() {
    const el = document.getElementById('profModelIndicator');
    if (!el) return;
    if (selectedModel && foundryOnline) {
        // Show friendly name: extract alias from model ID
        const friendly = selectedModel.replace(/-instruct.*$/, '').replace(/-/g, ' ');
        const device = selectedModel.includes('-npu:') ? 'NPU' : selectedModel.includes('-gpu:') ? 'GPU' : 'CPU';
        el.textContent = `${friendly} · ${device}`;
        el.style.display = 'inline';
    } else {
        el.textContent = 'offline';
        el.style.display = 'inline';
    }
}

// ---------------------------------------------------------------------------
// Tour Overlay — Open / Close
// ---------------------------------------------------------------------------
function openTourSetup() {
    const overlay = document.getElementById('tourOverlay');
    overlay.classList.add('open');
    tourOpen = true;

    // Hide floating professor widget/FAB so they don't cover tour chat
    document.getElementById('profFab').style.display = 'none';
    document.getElementById('profWidget').classList.remove('open');
    document.getElementById('profWidget').style.display = 'none';

    // Always show setup, hide active tour
    document.getElementById('tourSetupScreen').style.display = 'flex';
    document.getElementById('tourActive').style.display = 'none';
}

function closeTour() {
    const overlay = document.getElementById('tourOverlay');
    overlay.classList.remove('open');
    tourOpen = false;

    // Restore floating professor FAB
    document.getElementById('profFab').style.display = '';
    document.getElementById('profWidget').style.display = '';
    widgetOpen = false;
    document.getElementById('profFab').classList.remove('hidden');
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

        // Vendor-specific tip in cloned element
        const vendor = hw.summary.silicon_vendor;
        const tipEl = el.querySelector('#npuVendorTip');
        if (tipEl) {
            if (vendor === 'Intel') {
                tipEl.innerHTML = 'Your <strong>Intel AI Boost</strong> NPU uses the <strong>OpenVINO™</strong> execution provider for optimized inference. Look for models tagged with <code>-ov-npu</code> in Foundry Local.';
            } else if (vendor === 'Qualcomm') {
                tipEl.innerHTML = 'Your <strong>Qualcomm Hexagon</strong> NPU uses the <strong>QNN</strong> execution provider optimized for Hexagon. Look for models tagged with <code>-qnn-npu</code> in Foundry Local.';
            }
        }

        // Show deep dive in clone
        const deepDive = el.querySelector('#npuDeepDive');
        if (deepDive) deepDive.style.display = 'block';
        const intelDD = el.querySelector('#npuDeepDiveIntel');
        const qcDD = el.querySelector('#npuDeepDiveQualcomm');
        if (vendor === 'Intel' && intelDD) intelDD.style.display = 'block';
        if (vendor === 'Qualcomm' && qcDD) qcDD.style.display = 'block';
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

    // Check FAQ first — instant answers, no LLM needed
    const faqAnswer = checkFAQ(text);
    if (faqAnswer) {
        const bubble = appendProfMessage('professor', '');
        bubble.innerHTML = renderMarkdown(faqAnswer);
        profChatHistory.push({ role: 'assistant', content: faqAnswer });
        return;
    }

    // Re-check Foundry status if currently offline
    if (!foundryOnline || !selectedModel) {
        try {
            const statusResp = await fetch('/api/foundry/status');
            const statusData = await statusResp.json();
            updateFoundryUI(statusData);
        } catch {}
    }

    if (!foundryOnline || !selectedModel) {
        appendProfMessage('professor',
            '⚠️ Foundry Local is not running. Start it with <code>foundry service start</code> to enable chat. ' +
            'You can still navigate lessons and read the content! Common questions are answered instantly — try asking about NPUs, models, or AI concepts.'
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

        // Trim history to last 20 messages to avoid exceeding context window
        if (profChatHistory.length > 20) {
            profChatHistory = profChatHistory.slice(-20);
        }

        const resp = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: [...contextMessages, ...profChatHistory],
                model: selectedModel,
            }),
        });

        if (!resp.ok) {
            typingEl.remove();
            appendProfMessage('professor', `⚠️ Server error (${resp.status}). Try again or restart Foundry Local.`);
            profStreaming = false;
            return;
        }

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
        if (content && bubbleEl) {
            content += '\n\n*[Connection interrupted — try sending your message again.]*';
            bubbleEl.innerHTML = renderMarkdown(content);
            profChatHistory.push({ role: 'assistant', content });
        } else {
            appendProfMessage('professor', '⚠️ Connection to the model was lost. Try again in a moment.');
        }
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
    edgeai: {
        100: "🌐 Welcome to <strong>Edge AI</strong>! The big idea: instead of sending your data to a cloud server for AI processing, you run the AI <em>right here on your device</em>. It's faster, more private, and works offline. Your NPU is what makes this possible!",
        200: "🌐 Let's compare: cloud AI gives you the biggest models (GPT-4 class) but adds latency, costs per token, and sends your data over the internet. Edge AI uses smaller, optimized models locally — <strong>sub-10ms latency</strong>, <strong>zero API costs</strong>, and <strong>complete privacy</strong>. The right choice depends on your use case.",
        300: "🌐 Edge AI architecture relies on three pillars: <strong>model optimization</strong> (quantization, pruning, distillation to shrink models), <strong>hardware acceleration</strong> (NPU/GPU/CPU with specialized execution providers), and <strong>optimized runtimes</strong> (ONNX Runtime, DirectML, QNN). Together they enable a 14B-parameter model to run in 3 GB of RAM.",
        400: "🌐 Production edge deployment: consider <strong>hybrid cloud-edge patterns</strong> — use edge for real-time, privacy-sensitive inference and cloud for training, complex reasoning, and model updates. Monitor with telemetry (without sending user data), implement graceful fallbacks, and plan for model versioning across your device fleet."
    },
    slmfoundations: {
        100: "🧬 <strong>Small Language Models</strong> are the engines of edge AI. Unlike massive cloud models with hundreds of billions of parameters, SLMs range from 0.5B to 14B — small enough to fit on your device. Key families: Microsoft's <strong>Phi</strong>, Alibaba's <strong>Qwen</strong>, Google's <strong>Gemma</strong>, and Meta's <strong>Llama</strong>.",
        200: "🧬 Let's focus on Microsoft's Phi family — they proved that <strong>training data quality</strong> beats raw size. Phi-4-mini (3.8B params) outperforms many 7B models! And <strong>Phi-Silica</strong> is extraordinary: built directly into Windows 11, it generates 650 tokens/sec using only 1.5 watts on the NPU. No download needed — it's already on your Copilot+ PC.",
        300: "🧬 The open-source landscape is rich. <strong>Qwen2.5-7B</strong> supports 119 languages and is the top NPU model in Foundry Local. <strong>Gemma 3n</strong> uses Per-Layer Embeddings for 2-3 GB memory. <strong>DeepSeek R1</strong> distilled models bring chain-of-thought reasoning to 7B/14B sizes. Each family optimizes for different trade-offs.",
        400: "🧬 <strong>BitNET</strong> is the frontier. By using ternary weights {-1, 0, +1}, it replaces floating-point multiplication with simple addition — achieving <strong>1.37-6.17x speedups</strong> and <strong>55-82% energy reduction</strong>. This isn't just incremental improvement; it's a fundamental rethinking of how neural networks compute. Study the bitnet.cpp implementation to understand the future of ultra-efficient AI."
    },
    optimization: {
        100: "⚙️ Why can't you just take a big cloud model and run it on your PC? Because a 70B parameter model needs ~140 GB of memory in full precision! <strong>Model optimization</strong> shrinks models through quantization (reducing number precision), pruning (removing unnecessary connections), and distillation (training smaller models to mimic larger ones).",
        200: "⚙️ <strong>Quantization</strong> is the most impactful technique. Converting from FP32 to INT4 gives you an <strong>8x size reduction</strong> with only 2-5% quality loss. That's how a 7B model fits in 2.78 GB on your NPU! Three approaches: <strong>PTQ</strong> (quick, post-training), <strong>QAT</strong> (better quality, requires retraining), and <strong>Dynamic</strong> (runtime adaptation).",
        300: "⚙️ Meet your optimization tools: <strong>Microsoft Olive</strong> has 40+ built-in optimization passes and automatically selects the best ones for your target hardware. <strong>Qualcomm QNN</strong> optimizes specifically for Hexagon NPU — achieving up to 15x speedups. When you see <code>-qnn-npu</code> in a Foundry Local model name, that's QNN at work.",
        400: "⚙️ Advanced pipeline: start with <strong>knowledge distillation</strong> to train a smaller student model from a larger teacher. Apply <strong>structured pruning</strong> to remove entire attention heads or layers. Run <strong>Olive auto-opt</strong> for hardware-specific quantization. Finally, compile through <strong>QNN</strong> for NPU deployment. Validate quality at each step with benchmark datasets."
    },
    windowsml: {
        100: "💻 <strong>Windows AI Foundry</strong> is Microsoft's platform for on-device AI development. The key insight: you write your AI code once, and Windows ML + DirectML automatically routes it to the best available hardware — NPU, GPU, or CPU. Works on all Windows 11 24H2+ machines.",
        200: "💻 <strong>DirectML</strong> is the magic layer. When you load an ONNX model and call <code>AppendExecutionProvider_DmlExecutionProvider()</code>, DirectML figures out whether to use your NPU, GPU, or CPU — no platform-specific code needed. This is why the same app runs on Snapdragon ARM64 and Intel x64.",
        300: "💻 <strong>Phi-Silica</strong> is the built-in powerhouse. Access it via <code>PhiSilicaModel.CreateAsync()</code> in the Windows App SDK. At 650 tokens/sec and 1.5W, it's ideal for always-on features. The <strong>TextEmbedding API</strong> generates 384-dim vectors on the NPU for search and RAG. The <strong>OCR API</strong> extracts text from screen content — this is what powers Recall.",
        400: "💻 Cross-silicon development strategy: use <strong>ONNX as your interchange format</strong>, target DirectML for hardware abstraction, and test on both ARM64 and x64. For maximum NPU performance on Qualcomm, use QNN execution provider. For Intel, consider OpenVINO. For NVIDIA, CUDA. Windows ML handles the routing — your job is choosing the right model format."
    },
    agents: {
        100: "🤖 <strong>AI Agents</strong> are the next evolution beyond chatbots. While a chatbot generates text in response to a prompt, an agent can <em>reason</em> about tasks, <em>plan</em> multi-step approaches, and <em>call tools</em> — like searching the web, querying databases, or running code. And with Foundry Local, agents run entirely on your device!",
        200: "🤖 <strong>Function calling</strong> is the foundation of AI agents. Models with 'tools' support (Qwen2.5-7B on NPU, Phi-4-mini on CPU) can generate structured tool calls instead of text. You define available functions with JSON schemas, and the model decides when and how to use them.",
        300: "🤖 <strong>Multi-agent orchestration</strong>: for complex tasks, use multiple agents with different specializations — a researcher, a coder, a reviewer. A coordinator agent routes tasks to the right specialist. All agents share the same Foundry Local endpoint but have different system prompts. The <strong>Microsoft Agent Framework</strong> provides production-ready orchestration patterns.",
        400: "🤖 Production agent patterns: implement <strong>human-in-the-loop</strong> approval gates for irreversible actions. Use <strong>structured output</strong> (JSON mode) for reliable tool calling. Manage <strong>context windows</strong> by summarizing long conversations. Evaluate with <strong>batch inference</strong> across diverse scenarios. Monitor agent behavior in production with telemetry that respects privacy."
    },
    foundrycloud: {
        100: "☁️ <strong>Microsoft Foundry</strong> is Azure's AI platform at <a href='https://ai.azure.com' target='_blank'>ai.azure.com</a>. While Foundry Local runs models on your device, Microsoft Foundry gives you access to the most powerful cloud models — GPT-4o, Claude, Llama 4, and thousands more. Think of it as the cloud campus to complement your local NPU lab!",
        200: "☁️ Time to deploy! The <strong>Model Catalog</strong> has thousands of models. Start with <strong>GPT-4o</strong> for chat and <strong>text-embedding-ada-002</strong> for embeddings. Then try <strong>Model Router</strong> — a single endpoint that automatically routes to the best model for each prompt, balancing cost, latency, and quality across 18+ models.",
        300: "☁️ Integration time. The <code>azure-ai-projects</code> SDK gives you a unified client for everything — chat completions, embeddings, agents, evaluations. In Foundry, you only need <strong>one endpoint and one key</strong>. Check the code examples on this page and try connecting from your Python app!",
        400: "☁️ Production architecture: use <strong>Model Router</strong> in Balanced mode for general workloads (within 1-2% of best quality at lower cost). Switch to Quality mode for critical outputs. Layer <strong>AI Gateway</strong> on top for token limits and multi-team governance. Combine with edge inference for the ultimate hybrid pattern."
    },
    foundryagents: {
        100: "🕵️ Foundry Agent Service lets you build AI agents <em>in the cloud</em> — complementing the local agents you can build with Foundry Local. Cloud agents get access to the most powerful models and managed infrastructure. Three types: <strong>Prompt agents</strong> (no code), <strong>Workflow agents</strong> (visual orchestration), and <strong>Hosted agents</strong> (custom containers).",
        200: "🕵️ Let's build your first cloud agent! In the Foundry portal, go to <strong>Build → Agents → + New agent → Prompt agent</strong>. Define instructions, pick GPT-4o as the model, add tools like Code Interpreter and Web Search. Test in the Agents Playground, then grab the SDK code from the Code tab.",
        300: "🕵️ Advanced territory: <strong>Multi-agent workflows</strong> with ConnectedAgentTool let a coordinator agent delegate to specialists. And <strong>Foundry IQ</strong> gives agents access to your documents — it auto-chunks, embeds, indexes, and provides agentic retrieval with citations. Think of it as managed RAG that just works.",
        400: "🕵️ <strong>Hosted agents</strong> run your custom code in Foundry-managed containers — full control over logic, dependencies, and integrations. For production, combine hosted agents with Foundry IQ knowledge bases, AI Gateway governance, and the evaluation pipeline. This is enterprise-grade agent infrastructure."
    },
    governance: {
        100: "🛡️ As AI usage grows, <strong>governance becomes essential</strong>. AI Gateway uses Azure API Management to control who can use which models, how many tokens they can consume, and what policies apply. Think of it as the IT admin's control panel for AI workloads.",
        200: "🛡️ Let's set it up. In the Foundry portal, go to <strong>Admin → AI Gateway → Add AI Gateway</strong>. You'll create or connect an APIM instance (Basic v2 for dev/test). Once provisioned, enable your projects and start configuring token limits.",
        300: "🛡️ <strong>Token limits and multi-team control</strong>: set TPM (tokens per minute) limits per project to prevent any one team from monopolizing capacity. Register custom agents in the control plane for visibility. Configure MCP tool governance to control which tools agents can access.",
        400: "🛡️ Enterprise patterns: use <strong>Standard v2 or Premium v2 APIM</strong> for production with private endpoints. Configure compliance boundaries per project. Monitor via APIM Metrics and Logs. Layer with Azure Policy for subscription-wide AI governance. This is how you scale AI responsibly across a large organization."
    },
    hybridai: {
        100: "🔀 <strong>Hybrid AI</strong> is the best of both worlds. If you're already using Microsoft Foundry in the cloud, you don't have to choose between cloud and edge — you can use both! Run powerful models in the cloud for complex tasks, and run optimized models on your Copilot+ PC's NPU for real-time, private, offline tasks.",
        200: "🔀 The most common pattern: <strong>Tiered Inference</strong>. Simple queries go to the NPU (Phi-Silica or Foundry Local), complex queries go to cloud Foundry (GPT-4o). Both use OpenAI-compatible APIs, so your app just switches the base URL. Cloud for power, edge for speed and privacy.",
        300: "🔀 Here's where it gets powerful: <strong>Foundry evaluators</strong> let you validate edge model quality using cloud infrastructure. Generate outputs from your local SLM, upload to Foundry, and run evaluators for groundedness, relevance, and coherence. Set quality gates to catch regressions. This is how you maintain cloud-grade quality on edge devices.",
        400: "🔀 Production hybrid architecture: <strong>Cloud Train → Edge Deploy</strong> pipeline. Fine-tune with cloud GPU, optimize with Microsoft Olive for NPU (INT4 quantization via QNN), deploy to your Copilot+ PC fleet via Foundry Local. Use Foundry evaluators in CI/CD to validate every model update. Surface devices with Snapdragon X Elite NPUs deliver 45+ TOPS for interactive local inference."
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
// Browse Curriculum (free-form exploration)
// ---------------------------------------------------------------------------
function browseCurriculum() {
    closeTour();
    navigateTo('hardware');
    // Open the chatbot so Apollo is available while browsing
    if (!widgetOpen) toggleProfWidget();
}

// ---------------------------------------------------------------------------
// Floating Apollo Widget (always-available chatbot)
// ---------------------------------------------------------------------------
let widgetChatHistory = [];
let widgetStreaming = false;
let widgetOpen = false;

// ---------------------------------------------------------------------------
// FAQ System — Instant answers without hitting the LLM
// Covers the most common questions about NPU, Foundry Local, and the curriculum.
// If a question matches, we answer immediately (works offline, zero latency).
// If no match, falls through to the LLM chat.
// ---------------------------------------------------------------------------
const FAQ_DATABASE = [
    // NPU basics
    { patterns: ['what is an npu', 'what is npu', 'what does npu stand for', 'what\'s an npu', 'define npu'],
      answer: '**NPU** stands for **Neural Processing Unit** — a dedicated AI accelerator chip built into Copilot+ PCs. Unlike the CPU (general-purpose) or GPU (graphics/parallel), the NPU is optimized specifically for AI inference at extremely low power consumption.\n\n- **Performance**: 40+ TOPS (Trillion Operations Per Second)\n- **Power**: Runs AI workloads at a fraction of GPU/CPU wattage\n- **Use cases**: Always-on AI features like Recall, Click to Do, Semantic Search, and Super Resolution\n\n**Try this!** Go to the **Hardware** page to see your NPU details, or ask me "what can my NPU do?"' },

    { patterns: ['what can my npu do', 'what does the npu do', 'npu use cases', 'npu capabilities', 'why use npu', 'why npu'],
      answer: 'Your NPU enables AI features that run **entirely on-device** — no cloud needed:\n\n🔹 **Built In** (Windows features): Recall (screen memory), Click to Do (smart actions), Semantic Search (meaning-based file search), Super Resolution (AI upscaling)\n🔹 **Bolt On** (ISV apps): Adobe Premiere Pro, Teams, DaVinci Resolve, OBS Studio — these automatically use your NPU\n🔹 **Build Your Own**: Custom AI solutions using Foundry Local, ONNX Runtime, or Windows ML\n\nThe key advantage is **power efficiency** — the NPU delivers 40+ TOPS while using minimal battery, making always-on AI practical.\n\n**Try this!** Navigate to **Built In Features** to explore Recall, Click to Do, and more.' },

    { patterns: ['npu vs gpu', 'npu vs cpu', 'npu gpu cpu', 'difference between npu and gpu', 'npu compared to gpu', 'cpu vs gpu vs npu'],
      answer: '| | **CPU** | **GPU** | **NPU** |\n|---|---|---|---|\n| **Best for** | General computing | Graphics & parallel | AI inference |\n| **AI TOPS** | ~10 | Varies (high) | 40+ |\n| **Power** | Moderate | High | Very low |\n| **Model support** | Widest | Large models | Optimized models |\n| **Always-on AI** | ❌ Drains battery | ❌ Drains battery | ✅ Minimal power |\n\n**Rule of thumb**: NPU for always-on efficiency, GPU for raw throughput with large models, CPU for maximum compatibility.\n\n**Try this!** Check the **Edge AI** page for deeper comparisons.' },

    // Foundry Local
    { patterns: ['what is foundry local', 'what\'s foundry local', 'foundry local', 'what does foundry local do'],
      answer: '**Foundry Local** is Microsoft\'s runtime for running AI models entirely on your device. Think of it as a local AI server.\n\n🔑 **Key facts:**\n- Serves models through an **OpenAI-compatible API** on localhost\n- Supports NPU, GPU, and CPU inference\n- CLI tools: `foundry model list`, `foundry model run <alias>`, `foundry service start`\n- Dynamic port — use SDK discovery, don\'t hardcode\n- Works completely **offline** after first model download\n\n**Try this!** Run `foundry model list` in your terminal to see available models.' },

    { patterns: ['how to install foundry', 'install foundry local', 'get foundry local', 'setup foundry', 'foundry install'],
      answer: '**Installing Foundry Local** is easy:\n\n```\nwinget install Microsoft.FoundryLocal\n```\n\nThen install the Python SDK:\n```\npip install foundry-local-sdk openai\n```\n\nStart the service and run your first model:\n```\nfoundry service start\nfoundry model run phi-4-mini\n```\n\n**Try this!** Navigate to the **Foundry Local** page for the complete getting-started guide.' },

    { patterns: ['how to run a model', 'run model', 'first model', 'start a model', 'load a model'],
      answer: '**Running your first model in Foundry Local:**\n\n```bash\n# Start the service\nfoundry service start\n\n# Run Phi-4 Mini on NPU (recommended for Intel)\nfoundry model run phi-4-mini\n\n# Or list all available models first\nfoundry model list\n```\n\nThe first run downloads the model (~2-4 GB). After that, it starts near-instantly and works offline.\n\nIn code, use the OpenAI SDK:\n```python\nfrom openai import OpenAI\nclient = OpenAI(base_url="http://127.0.0.1:<port>/v1", api_key="none")\n```\n\n**Try this!** Go to the **Models** page to see which models are recommended for your hardware.' },

    { patterns: ['foundry not working', 'foundry offline', 'foundry error', 'foundry won\'t start', 'can\'t connect to foundry'],
      answer: '**Troubleshooting Foundry Local:**\n\n1. **Check status**: `foundry service status`\n2. **Start it**: `foundry service start`\n3. **Restart it**: `foundry service stop` then `foundry service start`\n4. **Check models**: `foundry model list` — make sure a model is downloaded\n5. **Port conflict**: Foundry uses a dynamic port. Don\'t hardcode — use SDK discovery.\n\nIf the chatbot says "offline", try refreshing the page. Surface AI Launchpad auto-starts Foundry when the app launches.\n\n**Try this!** Open a terminal and run `foundry service status` to check.' },

    // Models
    { patterns: ['what model should i use', 'which model', 'best model', 'recommend a model', 'model recommendation'],
      answer: '**Model recommendations depend on your hardware and task:**\n\n🔹 **Intel NPU**: phi-4-mini (best quality), qwen2.5-7b (versatile), qwen2.5-coder-7b (coding)\n🔹 **Qualcomm NPU**: qwen2.5-7b-qnn (top pick), phi-3.5-mini-qnn (lightweight)\n🔹 **Any CPU**: phi-4-mini-cpu (broad compatibility)\n🔹 **GPU**: phi-4-mini-gpu, deepseek-r1-7b (reasoning)\n\n**Speed vs Quality tradeoff**: Smaller models (0.5B-1.5B) are ultra-fast but less capable. 7B models balance speed and quality. 14B+ models need GPU.\n\n**Try this!** Go to the **Models** page — it shows personalized recommendations for your hardware.' },

    { patterns: ['what is an slm', 'what are slms', 'small language model', 'slm vs llm'],
      answer: '**SLMs (Small Language Models)** are AI models compact enough to run on your device:\n\n- **Size range**: 0.5B to 14B parameters (vs 175B+ for cloud LLMs like GPT-4)\n- **Key families**: Microsoft **Phi**, Alibaba **Qwen**, Google **Gemma**, Meta **Llama**\n- **Phi-Silica**: Built into Windows 11, runs at **650 tokens/sec at 1.5W** on the NPU\n\nSLMs trade some capability for dramatic efficiency gains — they\'re ideal for focused tasks like summarization, classification, code generation, and chat.\n\n**Try this!** Explore the **SLM Foundations** page for deep dives on each model family.' },

    { patterns: ['what is phi silica', 'phi silica', 'phi-silica', 'built in model'],
      answer: '**Phi-Silica** is extraordinary — it\'s an SLM built directly into Windows 11 on Copilot+ PCs:\n\n- **Speed**: 650 tokens/sec\n- **Power**: Only 1.5 watts\n- **No download needed** — already on your device\n- **API**: `PhiSilicaModel.CreateAsync()` in Windows App SDK\n- **Context**: ~4K tokens\n\nIt powers the **TextEmbedding API** (384-dim vectors for search/RAG) and **OCR API** (text extraction from screen content — this is what powers Recall).\n\n**Try this!** Check the **Windows ML** page for code examples.' },

    // AI Toolkit
    { patterns: ['what is ai toolkit', 'ai toolkit', 'how to use ai toolkit', 'install ai toolkit', 'foundry toolkit', 'what is foundry toolkit'],
      answer: '**Foundry Toolkit** (formerly **AI Toolkit**) is a VS Code extension for building AI apps and agents:\n\n- 📦 **Model Catalog**: Discover models from Microsoft Foundry, Foundry Local, GitHub, ONNX, Ollama, OpenAI, Anthropic, and Google\n- 🎮 **Playground**: Multi-modal chat (text, images, attachments) with parameter controls\n- 🤖 **Agent Builder & Inspector**: Design prompt agents with MCP tools, then debug them visually\n- 🧰 **Tool Catalog**: Connect Foundry tools and local MCP servers to your agents\n- 📊 **Evaluation & Tracing**: Built-in evaluators (F1, relevance, coherence) plus trace visualization\n- 🪟 **Profiling (Windows ML)**: Inspect ONNX model behavior on CPU/GPU/NPU\n- 🔧 **Fine-Tuning & Model Conversion**: Quantize for local CPU/GPU/NPU or fine-tune locally / in Azure\n\nInstall it from the VS Code Extensions marketplace: search for "AI Toolkit" or "Foundry Toolkit". Docs: code.visualstudio.com/docs/intelligentapps/overview\n\n**Try this!** Navigate to the **AI Toolkit** page for a complete walkthrough.' },

    // Windows features
    { patterns: ['what is recall', 'how does recall work', 'recall feature', 'explain recall'],
      answer: '**Recall** is like photographic memory for your PC:\n\n- Periodically captures screen snapshots\n- NPU runs **OCR** (text extraction) + **semantic embeddings** (meaning capture) on each snapshot\n- Search naturally: "that email about the deadline" finds it instantly\n- **Everything is encrypted** with Windows Hello — fully private and on-device\n\n**Requirements**: Copilot+ PC with NPU (40+ TOPS), 16GB+ RAM, BitLocker enabled.\n\n**Try this!** Visit the **Recall** page to learn how to set it up.' },

    { patterns: ['what is click to do', 'click to do', 'clicktodo'],
      answer: '**Click to Do** gives you an AI assistant that can see your screen:\n\n- Press **Win + Mouse Click** to activate\n- The NPU analyzes what you\'re pointing at in real-time\n- Smart actions: summarize text, edit images, search for context\n- Works across **any application** — it operates on screen pixels, not app APIs\n\n**Try this!** Visit the **Click to Do** page, then try pressing Win + Click on some text!' },

    { patterns: ['what is semantic search', 'semantic search', 'smart search'],
      answer: '**Semantic Search** upgrades Windows Search with AI understanding:\n\n- Instead of exact filename matching, it understands **meaning**\n- Search "vacation plans" to find "summer-trip-itinerary.docx"\n- The NPU generates **384-dimensional embedding vectors** for your files\n- Results ranked by **cosine similarity** — closeness in meaning-space\n\n**Try this!** Open Windows Search and try a natural language query instead of a filename.' },

    { patterns: ['what is super resolution', 'super resolution', 'auto sr', 'image upscaling'],
      answer: '**Super Resolution / Auto SR** uses the NPU to upscale images and game graphics in real-time:\n\n- AI-powered upscaling that adds detail (not just blurring up)\n- Works in supported games via **Auto SR**\n- Uses minimal power thanks to NPU acceleration\n\n**Try this!** Check the **Super Resolution** page to see how it works and which games support it.' },

    // Optimization
    { patterns: ['what is quantization', 'quantization', 'int4 int8', 'model compression'],
      answer: '**Quantization** shrinks AI models by reducing number precision:\n\n| Format | Size Reduction | Quality Loss |\n|---|---|---|\n| FP32 → FP16 | 2x | Minimal |\n| FP32 → INT8 | 4x | Small (1-3%) |\n| FP32 → INT4 | 8x | Moderate (2-5%) |\n\nThis is how a 7B-parameter model fits in **2.78 GB** on your NPU! Three approaches:\n- **PTQ** (Post-Training): Quick, no retraining\n- **QAT** (Quantization-Aware Training): Better quality\n- **Dynamic**: Adapts at runtime\n\n**Try this!** See the **Optimization** page for details on Microsoft Olive and QNN.' },

    // Agents
    { patterns: ['what are ai agents', 'ai agents', 'what is an agent', 'local agents'],
      answer: '**AI Agents** go beyond chatbots — they can **reason, plan, and use tools**:\n\n- **Function calling**: Models generate structured tool calls (search, code, database queries)\n- **Local agents**: Run entirely on-device with Foundry Local models that support "tools" capability\n- **Multi-agent**: Coordinate specialist agents for complex workflows\n- **Microsoft Agent Framework**: Production-ready orchestration patterns\n\n**Try this!** Visit the **AI Agents** page to learn about function calling and multi-agent patterns.' },

    // Cloud / Hybrid
    { patterns: ['what is microsoft foundry', 'foundry cloud', 'azure foundry', 'cloud vs local'],
      answer: '**Microsoft Foundry** (cloud) complements Foundry Local (on-device):\n\n- 🌐 **Cloud**: Access powerful models like GPT-4o, Model Router (auto-routes to best model), Foundry Agent Service\n- 💻 **Local**: Privacy-first, offline, zero API costs with NPU models\n- 🔀 **Hybrid**: Best of both — simple tasks on NPU, complex tasks in cloud. Same OpenAI-compatible API, just different `base_url`\n\n**Try this!** See the **Hybrid AI** page for patterns combining cloud and edge.' },

    // Vibe coding / blog
    { patterns: ['vibe coding', 'how to vibe code', 'what is vibe coding'],
      answer: '**Vibe Coding** is building apps by describing features to an AI coding assistant:\n\n1. Start with Foundry Local + OpenAI SDK\n2. Describe one feature at a time to your AI assistant\n3. Test on actual hardware (NPU quirks only surface on-device)\n4. Iterate: test → describe next feature → repeat\n\nFrank Buchholz from Surface built a full 4-tab AI demo app this way — check out his blog post: [Vibe Coding for the NPU](https://techcommunity.microsoft.com/blog/surfaceitpro/vibe-coding-for-the-npu/4497674)\n\n**Key insight**: "Hardware-in-the-loop is the key. Don\'t write a full spec. Write one feature at a time."' },

    // Speech / Voice
    { patterns: ['speech to text', 'voice input', 'voice mode', 'how does voice work', 'speech recognition', 'stt', 'tts', 'text to speech'],
      answer: '**Voice Mode** in Surface AI Launchpad uses **on-device Whisper** for speech-to-text and the **Web Speech API** for text-to-speech:\n\n🎤 **Speech-to-Text (STT)**: Click the microphone button → speak → click stop → your audio is transcribed on-device by Whisper and sent automatically\n🔊 **Text-to-Speech (TTS)**: Toggle the speaker icon → Apollo reads responses aloud\n\nBoth run **entirely on-device** — no cloud transcription service, no API costs. Whisper provides accurate, reliable transcription across all browsers.\n\n**Try this!** Click 🎤 below and ask a question by voice!' },

    // Surface AI Launchpad meta
    { patterns: ['what is surface ai launchpad', 'what is launchpad', 'what is npuniversity', 'what is this app', 'what is this', 'how to use this', 'help'],
      answer: '**Surface AI Launchpad** (formerly NPUniversity) is your mission control for learning and shipping on-device AI across CPU, GPU, and NPU on Copilot+ PCs!\n\n🚀 **How to use it:**\n1. **Sidebar navigation**: Browse topics from Getting Started → Deep Dive → Agents & Cloud\n2. **Mission Briefing**: Click the 🚀 button for a custom, timed mission plan\n3. **Chat with me**: Ask anything about NPUs, models, or AI development\n4. **Voice mode**: Click 🎤 to speak, toggle 🔊 for spoken responses\n\n**Topic areas**: Hardware, Foundry Local, Models, Foundry Toolkit, Windows NPU Features, Edge AI, Optimization, Agents, Cloud Foundry, Hybrid AI, ISV apps, and more.\n\n**Try this!** Start with the **Hardware** page to see your device\'s AI capabilities.' },

    { patterns: ['what can you do', 'what do you know', 'what are you', 'who are you'],
      answer: 'I\'m **Apollo** 🚀 — your AI mission commander at Surface AI Launchpad!\n\nI can help with:\n- 🔧 **NPU & Hardware**: What your device can do, NPU vs GPU vs CPU\n- 🏗️ **Foundry Local**: Setup, troubleshooting, running models\n- 🤖 **Models**: Which SLM to pick, quantization, optimization\n- 🧰 **Foundry Toolkit**: Playground, agents, fine-tuning, ONNX export\n- 🪟 **Windows AI**: Recall, Click to Do, Semantic Search, Super Resolution\n- 🤖 **Agents**: Function calling, multi-agent patterns\n- ☁️ **Cloud & Hybrid**: Microsoft Foundry, Model Router, hybrid patterns\n\nI answer common questions **instantly** from my mission database. For deeper questions, I use the AI model running on your NPU!\n\n**Try this!** Ask me "what is an NPU?" or "how do I run my first model?"' },

    // Getting started
    { patterns: ['where do i start', 'getting started', 'beginner', 'new to this', 'first steps'],
      answer: '**Welcome! Here\'s your quick start path:**\n\n1️⃣ **Hardware** — See your CPU, GPU, and NPU capabilities\n2️⃣ **Foundry Local** — Install the runtime and start the AI service\n3️⃣ **Models** — Pick the right SLM for your hardware and task\n4️⃣ **AI Toolkit** — Test models in the VS Code playground\n\nOr take the **Guided Tour** 🎓 — I\'ll build a custom lesson plan based on your time and skill level!\n\n**Try this!** Click the 🎓 button in the bottom-right to start a guided tour.' },
];

/**
 * Check if a user message matches an FAQ entry.
 * Returns the answer string if matched, or null if no match.
 * Uses normalized substring matching with keyword scoring.
 */
function checkFAQ(userText) {
    const normalized = userText.toLowerCase()
        .replace(/[?!.,;:'"]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (normalized.length < 3) return null;

    let bestMatch = null;
    let bestScore = 0;

    for (const faq of FAQ_DATABASE) {
        for (const pattern of faq.patterns) {
            const p = pattern.toLowerCase();
            // Exact match (after normalization)
            if (normalized === p) return faq.answer;
            // Check if the user message contains the full pattern
            if (normalized.includes(p)) {
                const score = p.length / normalized.length; // longer pattern = better match
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = faq;
                }
            }
            // Check if the pattern is contained in the user message
            if (p.includes(normalized) && normalized.length >= 8) {
                const score = normalized.length / p.length * 0.8;
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = faq;
                }
            }
        }
    }

    // Require a reasonable match score
    return bestScore >= 0.4 ? bestMatch?.answer : null;
}


function toggleProfWidget() {
    widgetOpen = !widgetOpen;
    const widget = document.getElementById('profWidget');
    const fab = document.getElementById('profFab');
    if (widgetOpen) {
        widget.classList.add('open');
        fab.classList.add('hidden');
        document.getElementById('profWidgetInput').focus();
    } else {
        widget.classList.remove('open');
        fab.classList.remove('hidden');
    }
}

function sendWidgetQuick(text) {
    document.getElementById('profWidgetInput').value = text;
    sendWidgetMessage();
}

async function sendWidgetMessage() {
    const input = document.getElementById('profWidgetInput');
    const text = input.value.trim();
    if (!text || widgetStreaming) return;

    input.value = '';
    appendWidgetMsg('student', escapeHtml(text));
    widgetChatHistory.push({ role: 'user', content: text });

    // Trim history to last 20 messages to avoid exceeding context window
    if (widgetChatHistory.length > 20) {
        widgetChatHistory = widgetChatHistory.slice(-20);
    }

    // Hide quick actions after first message
    const qa = document.querySelector('.prof-quick-actions');
    if (qa) qa.style.display = 'none';

    // Check FAQ first — instant answers, no LLM needed
    const faqAnswer = checkFAQ(text);
    if (faqAnswer) {
        const bubble = appendWidgetMsg('professor', '');
        bubble.innerHTML = renderMarkdown(faqAnswer);
        widgetChatHistory.push({ role: 'assistant', content: faqAnswer });
        scrollWidgetChat();
        if (voiceMode) speak(faqAnswer);
        return;
    }

    // Re-check Foundry status if currently offline (may have come back)
    if (!foundryOnline || !selectedModel) {
        try {
            const statusResp = await fetch('/api/foundry/status');
            const statusData = await statusResp.json();
            updateFoundryUI(statusData);
        } catch {}
    }

    if (!foundryOnline || !selectedModel) {
        appendWidgetMsg('professor',
            '⚠️ Foundry Local is offline. Start it with <code>foundry service start</code> to chat. ' +
            'You can still browse all the content! Common questions are answered instantly from my FAQ — try asking about NPUs, models, or Foundry Local.'
        );
        return;
    }

    widgetStreaming = true;
    const typingEl = appendWidgetTyping();

    try {
        const resp = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: widgetChatHistory,
                model: selectedModel,
            }),
        });

        if (!resp.ok) {
            typingEl.remove();
            appendWidgetMsg('professor', `⚠️ Server error (${resp.status}). Try again or restart Foundry Local.`);
            widgetStreaming = false;
            return;
        }

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
                            bubbleEl = appendWidgetMsg('professor', '');
                        }
                        content += delta;
                        bubbleEl.innerHTML = renderMarkdown(content);
                        scrollWidgetChat();
                    }
                } catch {}
            }
        }

        if (content) {
            widgetChatHistory.push({ role: 'assistant', content });
            // Speak the response if voice mode is on
            if (voiceMode) speak(content);
        }
    } catch (e) {
        typingEl?.remove();
        if (content && bubbleEl) {
            content += '\n\n*[Connection interrupted — try sending your message again.]*';
            bubbleEl.innerHTML = renderMarkdown(content);
            widgetChatHistory.push({ role: 'assistant', content });
        } else {
            appendWidgetMsg('professor',
                '⚠️ Connection to the model was lost. ' +
                '<button class="prof-retry-btn" onclick="retryLastMessage()">🔄 Retry</button>'
            );
            // Re-check Foundry status after connection failure
            try {
                const statusResp = await fetch('/api/foundry/status');
                const statusData = await statusResp.json();
                updateFoundryUI(statusData);
            } catch {}
        }
    }

    widgetStreaming = false;
}

/**
 * Retry the last user message after a connection failure.
 */
function retryLastMessage() {
    // Find the last user message in history
    const lastUserMsg = [...widgetChatHistory].reverse().find(m => m.role === 'user');
    if (lastUserMsg) {
        // Remove the error message bubble
        const msgs = document.getElementById('profWidgetMessages');
        const lastMsg = msgs.lastElementChild;
        if (lastMsg && lastMsg.querySelector('.prof-retry-btn')) {
            lastMsg.remove();
        }
        // Pop the last user message so it gets re-added
        const idx = widgetChatHistory.lastIndexOf(lastUserMsg);
        widgetChatHistory.splice(idx, 1);
        // Re-send
        document.getElementById('profWidgetInput').value = lastUserMsg.content;
        sendWidgetMessage();
    }
}

function appendWidgetMsg(role, content) {
    const container = document.getElementById('profWidgetMessages');
    const msg = document.createElement('div');
    msg.className = `prof-msg ${role}`;
    msg.innerHTML = content;
    container.appendChild(msg);
    scrollWidgetChat();
    return msg;
}

function appendWidgetTyping() {
    const container = document.getElementById('profWidgetMessages');
    const msg = document.createElement('div');
    msg.className = 'prof-msg professor';
    msg.innerHTML = '<div class="prof-typing"><span></span><span></span><span></span></div>';
    container.appendChild(msg);
    scrollWidgetChat();
    return msg;
}

function scrollWidgetChat() {
    const container = document.getElementById('profWidgetMessages');
    container.scrollTop = container.scrollHeight;
}

// ---------------------------------------------------------------------------
// Voice Mode — Speech-to-Text (STT) via on-device Whisper & Text-to-Speech (TTS)
// Uses MediaRecorder → /api/transcribe (faster-whisper) for reliable dictation.
// ---------------------------------------------------------------------------
let voiceMode = false;
let micListening = false;
let activeRecorder = null;
let activeStream = null;

function getSupportedMime() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (const t of types) { if (MediaRecorder.isTypeSupported(t)) return t; }
    return '';
}

function getExtForMime(mime) {
    if (mime.includes('webm')) return '.webm';
    if (mime.includes('ogg')) return '.ogg';
    if (mime.includes('mp4')) return '.mp4';
    return '.wav';
}

function toggleMic() {
    if (micListening) {
        stopMic();
    } else {
        startMic();
    }
}

async function startMic() {
    // Ensure widget is open
    if (!widgetOpen) toggleProfWidget();

    const btn = document.getElementById('profMicBtn');

    try {
        activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
        appendWidgetMsg('professor', '⚠️ Microphone access denied. Please allow microphone permission to use voice input.');
        return;
    }

    activeRecorder = new MediaRecorder(activeStream, { mimeType: getSupportedMime() });
    const chunks = [];

    activeRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    activeRecorder.onstop = async () => {
        btn.classList.remove('listening');
        btn.textContent = '🎤';
        btn.title = 'Voice input (speech-to-text)';
        micListening = false;

        if (activeStream) { activeStream.getTracks().forEach(t => t.stop()); activeStream = null; }

        const blob = new Blob(chunks, { type: activeRecorder.mimeType });
        activeRecorder = null;

        // Show transcribing status
        appendWidgetMsg('professor', '🎙️ Transcribing on-device...');

        const formData = new FormData();
        formData.append('audio', blob, 'recording' + getExtForMime(blob.type));

        try {
            const r = await fetch('/api/transcribe', { method: 'POST', body: formData });
            const d = await r.json();

            // Remove the "transcribing" message
            const msgs = document.getElementById('profWidgetMessages');
            const lastMsg = msgs.lastElementChild;
            if (lastMsg && lastMsg.textContent.includes('Transcribing')) lastMsg.remove();

            if (d.error) {
                appendWidgetMsg('professor', '⚠️ ' + d.error);
                return;
            }
            if (d.text && d.text.trim()) {
                document.getElementById('profWidgetInput').value = d.text.trim();
                sendWidgetMessage();
            } else {
                appendWidgetMsg('professor', '🎙️ No speech detected — try again.');
            }
        } catch (e) {
            const msgs = document.getElementById('profWidgetMessages');
            const lastMsg = msgs.lastElementChild;
            if (lastMsg && lastMsg.textContent.includes('Transcribing')) lastMsg.remove();
            appendWidgetMsg('professor', '⚠️ Transcription failed: ' + e.message);
        }
    };

    activeRecorder.start();
    micListening = true;
    btn.classList.add('listening');
    btn.textContent = '⏹️';
    btn.title = 'Stop recording';
}

function stopMic() {
    micListening = false;
    const btn = document.getElementById('profMicBtn');
    btn.classList.remove('listening');
    btn.textContent = '🎤';
    btn.title = 'Voice input (speech-to-text)';

    if (activeRecorder && activeRecorder.state !== 'inactive') {
        activeRecorder.stop();
    }
    if (activeStream) {
        activeStream.getTracks().forEach(t => t.stop());
        activeStream = null;
    }
}

// Text-to-Speech (on-device TTS)
function toggleVoiceMode() {
    voiceMode = !voiceMode;
    const btn = document.getElementById('profVoiceToggle');
    if (voiceMode) {
        btn.textContent = '🔊';
        btn.title = 'Voice mode ON — Professor will speak responses';
        btn.classList.add('active');
    } else {
        btn.textContent = '🔇';
        btn.title = 'Voice mode OFF';
        btn.classList.remove('active');
        // Stop any ongoing speech
        speechSynthesis.cancel();
    }
}

function speak(text) {
    if (!voiceMode || !('speechSynthesis' in window)) return;

    // Strip markdown/HTML for cleaner speech
    const clean = text
        .replace(/```[\s\S]*?```/g, '... code block omitted ...')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/#{1,6}\s/g, '')
        .replace(/[-*]\s/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/<[^>]+>/g, '')
        .trim();

    if (!clean) return;

    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    // Prefer a natural-sounding voice
    const voices = speechSynthesis.getVoices();
    const preferred = voices.find(v =>
        v.name.includes('Microsoft Mark') ||
        v.name.includes('Microsoft David') ||
        v.name.includes('Google US English') ||
        (v.lang === 'en-US' && v.localService)
    );
    if (preferred) utterance.voice = preferred;

    speechSynthesis.speak(utterance);
}

// Preload voices
if ('speechSynthesis' in window) {
    speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------
loadHardware();
loadFoundryStatus();

// Poll Foundry status every 30s — auto-recover if service comes back online
setInterval(async () => {
    try {
        const resp = await fetch('/api/foundry/status');
        const data = await resp.json();
        updateFoundryUI(data);
    } catch {}
}, 30000);

// Auto-open the guided tour on first launch
openTourSetup();
