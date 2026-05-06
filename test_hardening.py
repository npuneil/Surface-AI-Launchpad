"""
Surface AI Launchpad Hardening Test Suite
Comprehensive tests for student-facing reliability.
Tests: API endpoints, edge cases, FAQ system, XSS safety, streaming, error handling.
"""

import asyncio
import json
import time
import re
import httpx

BASE = "http://127.0.0.1:8080"
MODEL = "phi-4-mini-instruct-openvino-npu:3"
PASSED = 0
FAILED = 0
ERRORS = []


def result(name, ok, detail=""):
    global PASSED, FAILED, ERRORS
    if ok:
        PASSED += 1
        print(f"  ✅ {name}")
    else:
        FAILED += 1
        ERRORS.append(f"{name}: {detail}")
        print(f"  ❌ {name} — {detail}")


async def run_tests():
    timeout = httpx.Timeout(10.0, read=60.0)
    async with httpx.AsyncClient(timeout=timeout, base_url=BASE) as c:

        # ==================================================================
        print("\n━━━ 1. BASIC ENDPOINTS ━━━")
        # ==================================================================

        # 1a. Home page loads
        r = await c.get("/")
        result("GET / returns 200", r.status_code == 200)
        result("Home page has <html>", "<html" in r.text)
        result("Home page has Surface AI Launchpad", "Surface AI Launchpad" in r.text)

        # 1b. Static files
        r = await c.get("/static/app.js")
        result("GET /static/app.js returns 200", r.status_code == 200)
        result("app.js has FAQ_DATABASE", "FAQ_DATABASE" in r.text)

        r = await c.get("/static/style.css")
        result("GET /static/style.css returns 200", r.status_code == 200)

        # 1c. 404 for missing static files
        r = await c.get("/static/nonexistent.js")
        result("Missing static file returns 404", r.status_code == 404)

        # ==================================================================
        print("\n━━━ 2. HARDWARE ENDPOINT ━━━")
        # ==================================================================

        r = await c.get("/api/hardware")
        result("GET /api/hardware returns 200", r.status_code == 200)
        hw = r.json()
        result("Hardware has 'summary' key", "summary" in hw)
        result("Hardware has 'ram_gb'", "ram_gb" in hw, str(hw.keys()))
        result("Hardware summary has 'has_npu'", "has_npu" in hw.get("summary", {}))
        result("Hardware summary has 'silicon_vendor'", "silicon_vendor" in hw.get("summary", {}))

        # ==================================================================
        print("\n━━━ 3. MODELS ENDPOINT ━━━")
        # ==================================================================

        r = await c.get("/api/models")
        result("GET /api/models returns 200", r.status_code == 200)
        models = r.json()
        result("Models has 'recommendations'", "recommendations" in models)
        result("Models has 'hardware'", "hardware" in models)
        recs = models.get("recommendations", {})
        result("Recommendations is a dict", isinstance(recs, dict))
        result("At least 1 recommendation category", len(recs) >= 1, f"got {len(recs)}")

        # ==================================================================
        print("\n━━━ 4. FOUNDRY STATUS ENDPOINT ━━━")
        # ==================================================================

        r = await c.get("/api/foundry/status")
        result("GET /api/foundry/status returns 200", r.status_code == 200)
        status = r.json()
        result("Status has 'status' key", "status" in status)
        result("Foundry is online", status.get("status") == "online", status.get("status"))
        result("Status has 'loaded_models'", "loaded_models" in status)
        loaded = status.get("loaded_models", [])
        result("At least 1 loaded model", len(loaded) >= 1, f"got {len(loaded)}")

        # ==================================================================
        print("\n━━━ 5. LESSON PLAN ENDPOINT ━━━")
        # ==================================================================

        # Normal request
        r = await c.post("/api/lesson-plan", json={"level": 200, "time_minutes": 30})
        result("POST /api/lesson-plan returns 200", r.status_code == 200)
        plan = r.json()
        result("Plan has 'plan' key", "plan" in plan)
        result("Plan has entries", len(plan.get("plan", [])) > 0, f"got {len(plan.get('plan', []))}")
        result("Plan respects time budget", plan.get("total_minutes", 999) <= 30)

        # Edge: very short time
        r = await c.post("/api/lesson-plan", json={"level": 100, "time_minutes": 1})
        result("1-minute plan returns 200", r.status_code == 200)
        plan_short = r.json()
        result("1-minute plan is empty or small", len(plan_short.get("plan", [])) <= 1)

        # Edge: level 400
        r = await c.post("/api/lesson-plan", json={"level": 400, "time_minutes": 120})
        result("Level 400 plan returns 200", r.status_code == 200)

        # Edge: missing fields (should use defaults)
        r = await c.post("/api/lesson-plan", json={})
        result("Empty body uses defaults", r.status_code == 200)

        # ==================================================================
        print("\n━━━ 6. CHAT ENDPOINT — NORMAL ━━━")
        # ==================================================================

        # Normal streaming chat
        async with c.stream("POST", "/api/chat", json={
            "model": MODEL,
            "messages": [{"role": "user", "content": "Say hello in one sentence."}]
        }) as r:
            result("Chat streaming returns 200", r.status_code == 200)
            result("Chat content-type is event-stream",
                   "text/event-stream" in r.headers.get("content-type", ""),
                   r.headers.get("content-type"))
            chunks = []
            async for line in r.aiter_lines():
                if line.strip():
                    chunks.append(line)
                if "[DONE]" in line:
                    break
            result("Chat returns data chunks", len(chunks) > 1, f"got {len(chunks)} chunks")
            result("Chat ends with [DONE]", any("[DONE]" in c for c in chunks))

            # Parse a content chunk
            content_found = False
            for chunk in chunks:
                if chunk.startswith("data: ") and "[DONE]" not in chunk:
                    try:
                        parsed = json.loads(chunk[6:])
                        delta = parsed.get("choices", [{}])[0].get("delta", {}).get("content")
                        if delta:
                            content_found = True
                            break
                    except json.JSONDecodeError:
                        pass
            result("Chat returns parseable content", content_found)

        # ==================================================================
        print("\n━━━ 7. CHAT ENDPOINT — EDGE CASES ━━━")
        # ==================================================================

        # 7a. Empty messages array
        r = await c.post("/api/chat", json={"model": MODEL, "messages": []})
        result("Empty messages returns error", "error" in r.json(), r.text[:200])

        # 7b. Empty user content
        r = await c.post("/api/chat", json={
            "model": MODEL,
            "messages": [{"role": "user", "content": ""}]
        })
        result("Empty content returns error", "error" in r.json(), r.text[:200])

        # 7c. Whitespace-only content
        r = await c.post("/api/chat", json={
            "model": MODEL,
            "messages": [{"role": "user", "content": "   \n  "}]
        })
        result("Whitespace-only returns error", "error" in r.json(), r.text[:200])

        # 7d. Invalid JSON
        r = await c.post("/api/chat", content=b"not json",
                         headers={"Content-Type": "application/json"})
        result("Invalid JSON returns error", r.status_code in (200, 422),
               f"status={r.status_code}")

        # 7e. Missing model field (should still work with system prompt)
        r = await c.post("/api/chat", json={
            "messages": [{"role": "user", "content": "Hi"}]
        })
        # This may error from Foundry but shouldn't crash the server
        result("Missing model doesn't crash server", r.status_code in (200, 422, 500),
               f"status={r.status_code}")

        # 7f. Very long message (stress test token limits)
        long_msg = "Tell me about NPUs. " * 100  # ~2000 chars
        async with c.stream("POST", "/api/chat", json={
            "model": MODEL,
            "messages": [{"role": "user", "content": long_msg}]
        }) as r:
            result("Long message returns 200", r.status_code == 200)
            # Just drain the stream
            async for line in r.aiter_lines():
                if "[DONE]" in line:
                    break

        # 7g. Special characters in message
        r_special = await c.post("/api/chat", json={
            "model": MODEL,
            "messages": [{"role": "user", "content": "What about <script>alert('xss')</script>?"}]
        })
        result("Script tag in chat doesn't crash", r_special.status_code == 200)

        # 7h. Unicode / emoji in message
        async with c.stream("POST", "/api/chat", json={
            "model": MODEL,
            "messages": [{"role": "user", "content": "What is 🧠 NPU? 你好!"}]
        }) as r:
            result("Unicode/emoji message returns 200", r.status_code == 200)
            async for line in r.aiter_lines():
                if "[DONE]" in line:
                    break

        # ==================================================================
        print("\n━━━ 8. XSS / INJECTION SAFETY ━━━")
        # ==================================================================

        # Check that index.html doesn't have unsafe innerHTML with user input directly
        r = await c.get("/")
        html = r.text
        result("No inline onclick with eval", "eval(" not in html)
        result("No document.write usage", "document.write(" not in html)

        # Check app.js for escapeHtml usage
        r = await c.get("/static/app.js")
        js = r.text
        result("escapeHtml function exists", "function escapeHtml" in js)
        result("Student messages use escapeHtml",
               "escapeHtml(text)" in js or "escapeHtml(escapeHtml" in js)
        result("renderMarkdown used for AI responses", "renderMarkdown(content)" in js)

        # ==================================================================
        print("\n━━━ 9. FAQ SYSTEM (client-side validation) ━━━")
        # ==================================================================

        r = await c.get("/static/app.js")
        js = r.text

        # Extract FAQ patterns for validation
        faq_count = js.count("patterns:")
        result(f"FAQ has {faq_count} entries", faq_count >= 20, f"got {faq_count}")

        # Check key topics are covered
        faq_topics = [
            ("NPU basics", "what is an npu"),
            ("Foundry Local", "what is foundry local"),
            ("Models", "what model should i use"),
            ("AI Toolkit", "what is ai toolkit"),
            ("Recall", "what is recall"),
            ("Voice mode", "speech to text"),
            ("Getting started", "where do i start"),
            ("Help/meta", "what can you do"),
            ("Phi Silica", "phi silica"),
            ("Quantization", "quantization"),
            ("Agents", "ai agents"),
            ("Vibe coding", "vibe coding"),
        ]
        for topic, pattern in faq_topics:
            result(f"FAQ covers: {topic}", pattern in js.lower())

        # Check checkFAQ function exists and is called
        result("checkFAQ called in sendWidgetMessage", "checkFAQ(text)" in js)
        result("checkFAQ called in sendProfMessage",
               js.count("checkFAQ(text)") >= 2, f"found {js.count('checkFAQ(text)')} calls")

        # Check FAQ answers have "Try this!" suggestions
        try_this_count = js.count("Try this!")
        result(f"FAQ answers have 'Try this!' prompts ({try_this_count})", try_this_count >= 10)

        # ==================================================================
        print("\n━━━ 10. CHATBOT HARDENING FEATURES ━━━")
        # ==================================================================

        # Retry button
        result("retryLastMessage function exists", "function retryLastMessage" in js)
        result("Retry button in error handler", "prof-retry-btn" in js)

        # Foundry status re-check before showing offline
        recheck_count = js.count("updateFoundryUI(statusData)")
        result(f"Foundry re-check on offline ({recheck_count} places)", recheck_count >= 2)

        # Polling
        result("Foundry status polling (setInterval)", "setInterval" in js)

        # History trimming
        result("Widget chat history trimmed", "widgetChatHistory.length > 20" in js)
        result("Prof chat history trimmed", "profChatHistory.length > 20" in js)

        # ==================================================================
        print("\n━━━ 11. VOICE MODE ━━━")
        # ==================================================================

        result("SpeechRecognition init exists", "function initSpeechRecognition" in js)
        result("toggleMic function exists", "function toggleMic" in js)
        result("toggleVoiceMode function exists", "function toggleVoiceMode" in js)
        result("speak function exists", "function speak" in js)
        result("Voice mode blog reference",
               "vibe-coding-for-the-npu" in js)
        result("Mic button in HTML", 'id="profMicBtn"' in html)
        result("Voice toggle in HTML", 'id="profVoiceToggle"' in html)

        # ==================================================================
        print("\n━━━ 12. CONCURRENT REQUESTS ━━━")
        # ==================================================================

        # Multiple simultaneous status checks (student spam-clicking)
        tasks = [c.get("/api/foundry/status") for _ in range(10)]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        ok_count = sum(1 for r in results if not isinstance(r, Exception) and r.status_code == 200)
        result(f"10 concurrent status checks ({ok_count}/10 succeeded)", ok_count >= 8,
               f"only {ok_count}/10")

        # Multiple simultaneous hardware checks
        tasks = [c.get("/api/hardware") for _ in range(10)]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        ok_count = sum(1 for r in results if not isinstance(r, Exception) and r.status_code == 200)
        result(f"10 concurrent hardware checks ({ok_count}/10)", ok_count >= 8,
               f"only {ok_count}/10")

        # ==================================================================
        print("\n━━━ 13. RESPONSE TIMES ━━━")
        # ==================================================================

        # Home page should be fast (static file)
        t0 = time.time()
        await c.get("/")
        t_home = (time.time() - t0) * 1000
        result(f"Home page < 500ms ({t_home:.0f}ms)", t_home < 500)

        # Hardware endpoint
        t0 = time.time()
        await c.get("/api/hardware")
        t_hw = (time.time() - t0) * 1000
        result(f"Hardware API < 2000ms ({t_hw:.0f}ms)", t_hw < 2000)

        # Foundry status (cached)
        t0 = time.time()
        await c.get("/api/foundry/status")
        t_status = (time.time() - t0) * 1000
        result(f"Foundry status < 3000ms ({t_status:.0f}ms)", t_status < 3000)

        # ==================================================================
        print("\n━━━ 14. HTML STRUCTURE ━━━")
        # ==================================================================

        # Quick actions in widget
        result("Widget has quick-action buttons", "prof-quick-actions" in html)
        quick_btns = html.count("sendWidgetQuick(")
        result(f"Widget has {quick_btns} quick-action buttons", quick_btns >= 4)

        # Key structural elements
        result("Sidebar exists", 'class="sidebar"' in html or 'id="sidebar"' in html)
        result("Main content area exists", "<main" in html)
        result("Prof widget exists", 'id="profWidget"' in html)
        result("Prof FAB exists", 'id="profFab"' in html)
        result("Tour overlay exists", 'id="tourOverlay"' in html)

        # ==================================================================
        print("\n━━━ 15. CSS HARDENING ━━━")
        # ==================================================================

        r = await c.get("/static/style.css")
        css = r.text
        result("Retry button styled", ".prof-retry-btn" in css)
        result("Widget messages styled", ".prof-widget-messages" in css or ".prof-msg" in css)
        result("Mic button styled", ".prof-mic-btn" in css)
        result("Listening state styled", ".prof-mic-btn.listening" in css)

    # ==================================================================
    print("\n" + "=" * 60)
    print(f"  RESULTS: {PASSED} passed, {FAILED} failed, {PASSED + FAILED} total")
    print("=" * 60)

    if ERRORS:
        print("\n  FAILURES:")
        for err in ERRORS:
            print(f"    ❌ {err}")

    return FAILED == 0


if __name__ == "__main__":
    success = asyncio.run(run_tests())
    exit(0 if success else 1)
