"""
Get Started with NPU - A guide to on-device AI with Foundry Local
Detects silicon, recommends SLMs, and provides an AI chat assistant.
"""

import asyncio
import json
import os
import re
import subprocess
import httpx
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(title="NPUniversity")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")

# ---------------------------------------------------------------------------
# Hardware Detection (cached — shell calls are slow)
# ---------------------------------------------------------------------------

_hw_cache: dict | None = None

def _run_ps(command: str, timeout: int = 15) -> str:
    """Run a PowerShell command and return stdout."""
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command", command],
            capture_output=True, text=True, timeout=timeout
        )
        return result.stdout.strip()
    except Exception:
        return ""


def detect_hardware() -> dict:
    """Detect CPU, GPU, and NPU on this Windows machine (cached)."""
    global _hw_cache
    if _hw_cache is not None:
        return _hw_cache
    cpu_raw = _run_ps(
        "Get-CimInstance Win32_Processor | Select-Object -ExpandProperty Name"
    )
    gpu_raw = _run_ps(
        "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"
    )
    npu_raw = _run_ps(
        "pnputil /enum-devices /class ComputeAccelerator"
    )
    ram_raw = _run_ps(
        "[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)"
    )

    # Parse NPU
    npu_name = None
    npu_status = None
    if npu_raw:
        desc_match = re.search(r"Device Description:\s*(.+)", npu_raw)
        status_match = re.search(r"Status:\s*(\w+)", npu_raw)
        if desc_match:
            npu_name = desc_match.group(1).strip()
        if status_match:
            npu_status = status_match.group(1).strip()

    # Classify silicon vendor
    cpu_lower = cpu_raw.lower()
    if "snapdragon" in cpu_lower or "qualcomm" in cpu_lower:
        silicon_vendor = "Qualcomm"
        architecture = "ARM64"
    elif "intel" in cpu_lower or "core" in cpu_lower:
        silicon_vendor = "Intel"
        architecture = "x64"
    elif "amd" in cpu_lower or "ryzen" in cpu_lower:
        silicon_vendor = "AMD"
        architecture = "x64"
    elif "apple" in cpu_lower:
        silicon_vendor = "Apple"
        architecture = "ARM64"
    else:
        silicon_vendor = "Unknown"
        architecture = "Unknown"

    result = {
        "cpu": {
            "name": cpu_raw or "Unknown",
            "vendor": silicon_vendor,
            "architecture": architecture,
        },
        "gpu": {
            "name": gpu_raw or "Not detected",
            "detected": bool(gpu_raw),
        },
        "npu": {
            "name": npu_name or "Not detected",
            "status": npu_status or "Not found",
            "detected": npu_name is not None,
        },
        "ram_gb": int(ram_raw) if ram_raw.isdigit() else 0,
        "summary": {
            "has_cpu": True,
            "has_gpu": bool(gpu_raw),
            "has_npu": npu_name is not None,
            "silicon_vendor": silicon_vendor,
        },
    }
    _hw_cache = result
    return result


# ---------------------------------------------------------------------------
# Foundry Local Service Discovery (cached with TTL)
# ---------------------------------------------------------------------------

import time
_foundry_cache: tuple[str | None, float] = (None, 0)

def get_foundry_base_url() -> str | None:
    """Discover the Foundry Local service URL (port is dynamic). Cached for 60s."""
    global _foundry_cache
    url, ts = _foundry_cache
    if url and (time.monotonic() - ts) < 60:
        return url
    try:
        result = subprocess.run(
            ["foundry", "service", "status"],
            capture_output=True, text=True, timeout=10
        )
        combined = result.stdout + result.stderr
        match = re.search(r"(https?://[\d.]+:\d+)", combined)
        if match:
            url = match.group(1)
            _foundry_cache = (url, time.monotonic())
            return url
    except Exception:
        pass
    _foundry_cache = (None, 0)
    return None


# ---------------------------------------------------------------------------
# Model Catalog & Recommendations
# ---------------------------------------------------------------------------

FOUNDRY_MODELS = [
    # NPU models
    {"alias": "qwen2.5-7b", "device": "NPU", "tasks": ["chat", "tools"], "size_gb": 2.78, "model_id": "qwen2.5-7b-instruct-qnn-npu:2", "quality": 8, "speed": 9, "description": "Best all-around NPU model. Great for chat, reasoning, and tool use."},
    {"alias": "qwen2.5-1.5b", "device": "NPU", "tasks": ["chat", "tools"], "size_gb": 2.78, "model_id": "qwen2.5-1.5b-instruct-qnn-npu:2", "quality": 6, "speed": 10, "description": "Fastest NPU model. Good for quick responses and lightweight tasks."},
    {"alias": "deepseek-r1-7b", "device": "NPU", "tasks": ["chat"], "size_gb": 3.71, "model_id": "deepseek-r1-distill-qwen-7b-qnn-npu:2", "quality": 8, "speed": 7, "description": "Strong reasoning model on NPU. Excellent for step-by-step thinking."},
    {"alias": "deepseek-r1-14b", "device": "NPU", "tasks": ["chat"], "size_gb": 7.12, "model_id": "deepseek-r1-distill-qwen-14b-qnn-npu:2", "quality": 9, "speed": 5, "description": "Most capable NPU reasoning model. Best for complex analysis."},
    {"alias": "phi-3.5-mini", "device": "NPU", "tasks": ["chat"], "size_gb": 2.78, "model_id": "phi-3.5-mini-instruct-qnn-npu:2", "quality": 7, "speed": 9, "description": "Microsoft Phi model optimized for NPU. Compact and efficient."},
    {"alias": "phi-3-mini-128k", "device": "NPU", "tasks": ["chat"], "size_gb": 2.78, "model_id": "phi-3-mini-128k-instruct-qnn-npu:3", "quality": 7, "speed": 8, "description": "Phi-3 with 128K context on NPU. Great for long documents."},
    {"alias": "phi-3-mini-4k", "device": "NPU", "tasks": ["chat"], "size_gb": 2.78, "model_id": "phi-3-mini-4k-instruct-qnn-npu:3", "quality": 7, "speed": 9, "description": "Phi-3 mini for quick conversational tasks on NPU."},
    # CPU models
    {"alias": "phi-4-mini", "device": "CPU", "tasks": ["chat", "tools"], "size_gb": 4.80, "model_id": "Phi-4-mini-instruct-generic-cpu:5", "quality": 9, "speed": 6, "description": "Top-quality small model on CPU. Excellent instruction following."},
    {"alias": "phi-4", "device": "CPU", "tasks": ["chat"], "size_gb": 10.16, "model_id": "Phi-4-generic-cpu:2", "quality": 10, "speed": 3, "description": "Best quality CPU model. Deep reasoning and nuanced responses."},
    {"alias": "phi-4-mini-reasoning", "device": "CPU", "tasks": ["chat"], "size_gb": 4.52, "model_id": "Phi-4-mini-reasoning-generic-cpu:3", "quality": 9, "speed": 5, "description": "Phi-4 mini tuned for reasoning chains. Great for logic/math."},
    {"alias": "qwen2.5-7b", "device": "CPU", "tasks": ["chat", "tools"], "size_gb": 6.16, "model_id": "qwen2.5-7b-instruct-generic-cpu:4", "quality": 8, "speed": 5, "description": "Versatile 7B model. Strong at chat and function calling."},
    {"alias": "qwen2.5-0.5b", "device": "CPU", "tasks": ["chat", "tools"], "size_gb": 0.80, "model_id": "qwen2.5-0.5b-instruct-generic-cpu:4", "quality": 5, "speed": 10, "description": "Ultra-fast tiny model. Good for drafting and simple Q&A."},
    {"alias": "qwen2.5-coder-7b", "device": "CPU", "tasks": ["chat", "tools"], "size_gb": 6.16, "model_id": "qwen2.5-coder-7b-instruct-generic-cpu:4", "quality": 8, "speed": 5, "description": "Code-specialized 7B model. Best for programming tasks."},
    {"alias": "qwen2.5-coder-1.5b", "device": "CPU", "tasks": ["chat", "tools"], "size_gb": 1.78, "model_id": "qwen2.5-coder-1.5b-instruct-generic-cpu:4", "quality": 6, "speed": 8, "description": "Lightweight coding assistant. Fast code completion."},
    {"alias": "qwen3-0.6b", "device": "CPU", "tasks": ["chat", "tools"], "size_gb": 0.58, "model_id": "qwen3-0.6b-generic-cpu:4", "quality": 5, "speed": 10, "description": "Latest Qwen tiny model. Impressive quality for its size."},
    {"alias": "gpt-oss-20b", "device": "CPU", "tasks": ["chat"], "size_gb": 12.26, "model_id": "gpt-oss-20b-generic-cpu:1", "quality": 10, "speed": 2, "description": "Largest available model. Best raw quality but requires patience."},
    {"alias": "deepseek-r1-7b", "device": "CPU", "tasks": ["chat"], "size_gb": 6.43, "model_id": "deepseek-r1-distill-qwen-7b-generic-cpu:4", "quality": 8, "speed": 5, "description": "Reasoning model on CPU. Good chain-of-thought responses."},
    {"alias": "mistral-7b-v0.2", "device": "CPU", "tasks": ["chat"], "size_gb": 4.07, "model_id": "mistralai-Mistral-7B-Instruct-v0-2-generic-cpu:3", "quality": 7, "speed": 6, "description": "Classic instruction model. Balanced performance."},
]

TASK_PROFILES = {
    "general_chat": {"label": "General Chat & Q&A", "icon": "💬", "prefer_tasks": ["chat"], "prefer_quality": True},
    "coding": {"label": "Code Generation", "icon": "💻", "prefer_tasks": ["chat", "tools"], "prefer_coder": True},
    "reasoning": {"label": "Reasoning & Analysis", "icon": "🧠", "prefer_tasks": ["chat"], "prefer_reasoning": True},
    "tool_calling": {"label": "Tool / Function Calling", "icon": "🔧", "prefer_tasks": ["tools"], "prefer_quality": True},
    "quick_draft": {"label": "Quick Drafting & Summaries", "icon": "⚡", "prefer_tasks": ["chat"], "prefer_speed": True},
    "long_context": {"label": "Long Document Processing", "icon": "📄", "prefer_tasks": ["chat"], "prefer_long_ctx": True},
}


# ---------------------------------------------------------------------------
# Curriculum & Lesson Plans
# ---------------------------------------------------------------------------

CURRICULUM = {
    "hardware": {
        "title": "Hardware Detection", "icon": "🔍", "page": "hardware",
        "levels": {
            100: {"title": "Know Your Silicon", "duration": 3, "summary": "Discover what AI hardware is in your PC"},
            200: {"title": "CPU vs GPU vs NPU", "duration": 5, "summary": "Understand which processor handles which AI tasks"},
            300: {"title": "TOPS & Performance Metrics", "duration": 8, "summary": "Benchmark your hardware's AI throughput"},
            400: {"title": "Hardware-Aware Model Selection", "duration": 10, "summary": "Match models to hardware for optimal inference"},
        }
    },
    "models": {
        "title": "Model Recommendations", "icon": "🤖", "page": "models",
        "levels": {
            100: {"title": "What Are SLMs?", "duration": 3, "summary": "Small Language Models that run on your device"},
            200: {"title": "Choosing the Right Model", "duration": 5, "summary": "Pick models based on task, speed, and quality"},
            300: {"title": "Model Quantization & Formats", "duration": 10, "summary": "ONNX, GGUF, QNN — understanding model formats"},
            400: {"title": "Benchmarking & Evaluation", "duration": 12, "summary": "Systematically compare models for your use case"},
        }
    },
    "foundry": {
        "title": "Foundry Local", "icon": "🏗️", "page": "foundry",
        "levels": {
            100: {"title": "What Is Foundry Local?", "duration": 3, "summary": "Local AI runtime — no cloud required"},
            200: {"title": "Install & First Model", "duration": 8, "summary": "Get Foundry running and chat with your first SLM"},
            300: {"title": "API Integration", "duration": 12, "summary": "Use the OpenAI-compatible API in your apps"},
            400: {"title": "Production Architecture", "duration": 15, "summary": "Architecture patterns for local AI applications"},
        }
    },
    "toolkit": {
        "title": "AI Toolkit", "icon": "🧰", "page": "toolkit",
        "levels": {
            100: {"title": "AI Toolkit Overview", "duration": 3, "summary": "VS Code extension for model development"},
            200: {"title": "Playground & Testing", "duration": 5, "summary": "Test prompts and compare model outputs"},
            300: {"title": "Fine-Tuning with LoRA", "duration": 12, "summary": "Customize models with your own data"},
            400: {"title": "Optimization & Export", "duration": 15, "summary": "ONNX export and deployment pipelines"},
        }
    },
    "recall": {
        "title": "Recall", "icon": "🔄", "page": "recall",
        "levels": {
            100: {"title": "What Is Recall?", "duration": 3, "summary": "AI-powered photographic memory for your PC"},
            200: {"title": "Enable & Configure", "duration": 5, "summary": "Set up Recall on your Copilot+ PC"},
            300: {"title": "Privacy & Architecture", "duration": 8, "summary": "How NPU powers on-device OCR and embeddings"},
            400: {"title": "Building with Recall APIs", "duration": 10, "summary": "Integrate screen context into your applications"},
        }
    },
    "clicktodo": {
        "title": "Click to Do", "icon": "👆", "page": "clicktodo",
        "levels": {
            100: {"title": "What Is Click to Do?", "duration": 2, "summary": "AI actions on anything on your screen"},
            200: {"title": "Using Click to Do", "duration": 4, "summary": "Activate and explore context-aware actions"},
            300: {"title": "Workflows & Customization", "duration": 6, "summary": "Configure actions and AI-assisted workflows"},
            400: {"title": "Screen Understanding", "duration": 8, "summary": "How NPU vision models analyze screen content"},
        }
    },
    "semanticsearch": {
        "title": "Semantic Search", "icon": "🔎", "page": "semanticsearch",
        "levels": {
            100: {"title": "What Is Semantic Search?", "duration": 2, "summary": "Search by meaning, not just keywords"},
            200: {"title": "Better Search Queries", "duration": 4, "summary": "Tips for natural language file search"},
            300: {"title": "Embeddings & Vectors", "duration": 8, "summary": "How NPU generates semantic embeddings"},
            400: {"title": "Building RAG Apps", "duration": 12, "summary": "Local RAG pipelines with Windows Copilot Runtime"},
        }
    },
}

TOPIC_ORDER = ["hardware", "foundry", "models", "toolkit", "recall", "clicktodo", "semanticsearch"]


def recommend_models(has_npu: bool, ram_gb: int) -> dict:
    """Return task-based model recommendations."""
    recommendations = {}
    for task_key, profile in TASK_PROFILES.items():
        picks = []
        for model in FOUNDRY_MODELS:
            # Filter by available device
            if model["device"] == "NPU" and not has_npu:
                continue
            # Filter by RAM (rough: model_size * 1.5 should fit)
            if model["size_gb"] * 1.5 > ram_gb:
                continue
            # Must support at least one preferred task
            if not any(t in model["tasks"] for t in profile["prefer_tasks"]):
                if not profile.get("prefer_quality"):
                    continue

            score = 0
            if profile.get("prefer_speed"):
                score = model["speed"] * 2 + model["quality"]
            elif profile.get("prefer_quality"):
                score = model["quality"] * 2 + model["speed"]
            elif profile.get("prefer_reasoning"):
                score = model["quality"] * 2 + (3 if "deepseek" in model["alias"] or "reasoning" in model["alias"] else 0)
            elif profile.get("prefer_coder"):
                score = model["quality"] * 2 + (5 if "coder" in model["alias"] else 0)
            elif profile.get("prefer_long_ctx"):
                score = model["quality"] * 2 + (5 if "128k" in model["alias"] else 0)
            else:
                score = model["quality"] + model["speed"]

            # Bonus for NPU (power efficiency)
            if model["device"] == "NPU":
                score += 3

            picks.append({**model, "score": score})

        picks.sort(key=lambda m: m["score"], reverse=True)
        recommendations[task_key] = {
            **profile,
            "top_pick": picks[0] if picks else None,
            "alternatives": picks[1:4] if len(picks) > 1 else [],
        }
    return recommendations


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
async def root():
    with open(BASE_DIR / "static" / "index.html", encoding="utf-8") as f:
        return f.read()


@app.get("/api/hardware")
async def api_hardware():
    hw = detect_hardware()
    return hw


@app.get("/api/models")
async def api_models():
    hw = detect_hardware()
    recs = recommend_models(hw["summary"]["has_npu"], hw["ram_gb"])
    return {"hardware": hw, "recommendations": recs}


@app.get("/api/foundry/status")
async def api_foundry_status():
    base = get_foundry_base_url()
    if not base:
        return {"status": "offline", "url": None}
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{base}/v1/models")
            models = r.json().get("data", [])
            return {"status": "online", "url": base, "loaded_models": [m["id"] for m in models]}
    except Exception:
        return {"status": "error", "url": base}


@app.post("/api/lesson-plan")
async def api_lesson_plan(request: Request):
    body = await request.json()
    level = body.get("level", 200)
    time_minutes = body.get("time_minutes", 30)

    plan = []
    remaining = time_minutes

    for topic_key in TOPIC_ORDER:
        topic = CURRICULUM[topic_key]
        lesson = topic["levels"].get(level)
        if lesson and lesson["duration"] <= remaining:
            plan.append({
                "topic": topic_key,
                "title": topic["title"],
                "icon": topic["icon"],
                "page": topic["page"],
                "level": level,
                "lesson_title": lesson["title"],
                "duration": lesson["duration"],
                "summary": lesson["summary"],
            })
            remaining -= lesson["duration"]

    return {
        "plan": plan,
        "total_minutes": time_minutes - remaining,
        "time_budget": time_minutes,
        "level": level,
    }


@app.post("/api/chat")
async def api_chat(request: Request):
    body = await request.json()
    messages = body.get("messages", [])
    model_id = body.get("model")

    base = get_foundry_base_url()
    if not base:
        return {"error": "Foundry Local service not running. Start it with: foundry service start"}

    # Build system prompt for Professor NPU
    system_msg = {
        "role": "system",
        "content": (
            "You are Professor NPU, the resident AI expert at NPUniversity — a virtual campus "
            "dedicated to teaching on-device AI with Windows Copilot+ PCs.\n\n"
            "You speak with academic enthusiasm but keep things practical and hands-on. "
            "You wear a virtual mortarboard 🎓 and love making complex AI concepts accessible.\n\n"
            "**Your expertise covers:**\n"
            "- **Foundry Local**: Microsoft's local model runtime. CLI: `foundry model list`, "
            "`foundry model run <alias>`, `foundry service start/stop/status`. "
            "OpenAI-compatible API at service URL + `/v1/chat/completions`.\n"
            "- **AI Toolkit for VS Code**: Model playground, fine-tuning with LoRA/QLoRA, ONNX export.\n"
            "- **Windows NPU Features**: Recall (screen memory), Click to Do (context actions), "
            "Semantic Search (meaning-based file search).\n"
            "- **NPU vs CPU vs GPU**: NPU = power efficiency + always-on AI (45 TOPS). "
            "CPU = most compatible. GPU = best raw throughput.\n\n"
            "**Teaching style:**\n"
            "- Match depth to the student's course level (100=intro, 200=fundamentals, "
            "300=intermediate, 400=advanced)\n"
            "- Always include practical examples, CLI commands, or code snippets\n"
            "- Use encouraging language ('Great question!', 'Let\\'s explore that...')\n"
            "- End responses with a 'Try this!' suggestion when appropriate\n"
            "- Keep answers concise — students are on a timed lesson plan\n"
            "- Use markdown formatting for clarity"
        )
    }

    full_messages = [system_msg] + messages

    async def stream_response():
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                async with client.stream(
                    "POST",
                    f"{base}/v1/chat/completions",
                    json={
                        "model": model_id,
                        "messages": full_messages,
                        "stream": True,
                        "temperature": 0.7,
                        "max_tokens": 2048,
                    },
                ) as resp:
                    async for line in resp.aiter_lines():
                        if line.startswith("data: "):
                            data = line[6:]
                            if data.strip() == "[DONE]":
                                yield "data: [DONE]\n\n"
                                break
                            yield f"data: {data}\n\n"
        except httpx.ReadTimeout:
            yield 'data: {"choices":[{"delta":{"content":"\\n\\n*[Response timed out — try a smaller/faster model]*"}}]}\n\n'
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f'data: {{"choices":[{{"delta":{{"content":"Error: {str(e)}"}}}}]}}\n\n'
            yield "data: [DONE]\n\n"

    return StreamingResponse(stream_response(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8080)
