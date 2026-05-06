"""
Get Started with NPU - A guide to on-device AI with Foundry Local
Detects silicon, recommends SLMs, and provides an AI chat assistant.
"""

import asyncio
import json
import os
import re
import subprocess
import tempfile
import time
import httpx
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, UploadFile, File
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

# Lazy-load speech-to-text so slow imports don't block server startup
STT_SUPPORT: bool | None = None  # None = not checked yet
sr = None  # type: ignore
AudioSegment = None  # type: ignore

def _ensure_stt():
    """Lazy-load SpeechRecognition + pydub on first use."""
    global STT_SUPPORT, sr, AudioSegment
    if STT_SUPPORT is not None:
        return STT_SUPPORT
    try:
        import speech_recognition as _sr
        from pydub import AudioSegment as _AudioSegment
        sr = _sr
        AudioSegment = _AudioSegment
        STT_SUPPORT = True
    except ImportError:
        STT_SUPPORT = False
    return STT_SUPPORT

BASE_DIR = Path(__file__).resolve().parent


async def _start_foundry_background():
    """Start Foundry Local in background — ALL sync calls via to_thread() to
    avoid blocking the event loop (which would prevent /health from responding)."""
    if os.environ.get("FOUNDRY_URL"):
        return
    url = await asyncio.to_thread(get_foundry_base_url)
    if url:
        print("\u2713 Foundry Local is already running")
        return
    print("\u23f3 Starting Foundry Local service (background)...")
    try:
        subprocess.Popen(
            ["foundry", "service", "start"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        # Poll with a real deadline; use cheap health-check, not full CLI discovery
        import time as _time
        deadline = _time.monotonic() + 90
        while _time.monotonic() < deadline:
            await asyncio.sleep(2)
            url = await asyncio.to_thread(get_foundry_base_url, True)
            if url:
                print("\u2713 Foundry Local started successfully")
                return
        print("\u26a0 Foundry Local did not respond within 90s \u2014 chat may be unavailable")
    except FileNotFoundError:
        print("\u26a0 'foundry' CLI not found \u2014 install Foundry Local to enable chat")
    except Exception as e:
        print(f"\u26a0 Could not start Foundry Local: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Kick off Foundry Local startup as a background task so the server
    starts accepting HTTP requests immediately."""
    asyncio.create_task(_start_foundry_background())
    yield


app = FastAPI(title="Surface AI Launchpad", lifespan=lifespan)
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


def _run_ps_all(commands: list[str], timeout: int = 15) -> list[str]:
    """Run multiple PowerShell commands in parallel and return results."""
    import concurrent.futures
    def _exec(cmd):
        return _run_ps(cmd, timeout=timeout)
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(commands)) as pool:
        return list(pool.map(_exec, commands))


def detect_hardware() -> dict:
    """Detect CPU, GPU, and NPU on this Windows machine (cached)."""
    global _hw_cache
    if _hw_cache is not None:
        return _hw_cache
    cpu_raw, gpu_raw, npu_raw, ram_raw = _run_ps_all([
        "Get-CimInstance Win32_Processor | Select-Object -ExpandProperty Name",
        "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
        "pnputil /enum-devices /class ComputeAccelerator",
        "[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)",
    ])

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
# Foundry Local Service Discovery (cached with TTL + fallback)
# ---------------------------------------------------------------------------

import time
_foundry_cache: tuple[str | None, float] = (None, 0)
_foundry_last_known: str | None = None   # survives cache expiry for health-check fallback

def _check_foundry_health(url: str) -> bool:
    """Quick HTTP health check against a Foundry URL."""
    try:
        r = httpx.get(f"{url}/v1/models", timeout=3)
        return r.status_code == 200
    except Exception:
        return False

def get_foundry_base_url(force_refresh: bool = False) -> str | None:
    """Discover the Foundry Local service URL (port is dynamic). Cached for 300s.
    Falls back to last-known URL with health check before running the slow CLI.
    Override with FOUNDRY_URL env var when running in Docker."""
    global _foundry_cache, _foundry_last_known
    # Allow explicit override (useful in containers)
    env_url = os.environ.get("FOUNDRY_URL")
    if env_url:
        return env_url.rstrip("/")
    url, ts = _foundry_cache
    if not force_refresh and url and (time.monotonic() - ts) < 300:
        return url

    # Try last-known URL first (fast HTTP check vs slow subprocess)
    if _foundry_last_known and _check_foundry_health(_foundry_last_known):
        _foundry_cache = (_foundry_last_known, time.monotonic())
        return _foundry_last_known

    # Run CLI discovery
    try:
        result = subprocess.run(
            ["foundry", "service", "status"],
            capture_output=True, text=True, timeout=15
        )
        combined = result.stdout + result.stderr
        match = re.search(r"(https?://[\d.]+:\d+)", combined)
        if match:
            url = match.group(1)
            _foundry_cache = (url, time.monotonic())
            _foundry_last_known = url
            return url
    except Exception:
        pass

    # Last resort: try common default port
    for port in [49904, 5272]:
        fallback = f"http://127.0.0.1:{port}"
        if _check_foundry_health(fallback):
            _foundry_cache = (fallback, time.monotonic())
            _foundry_last_known = fallback
            return fallback

    _foundry_cache = (None, 0)
    return None


# ---------------------------------------------------------------------------
# Model Catalog & Recommendations
# ---------------------------------------------------------------------------

FOUNDRY_MODELS = [
    # NPU models — Intel (OpenVINO)
    {"alias": "phi-4-mini", "device": "NPU", "tasks": ["chat", "tools"], "size_gb": 2.15, "model_id": "phi-4-mini-instruct-openvino-npu:3", "quality": 9, "speed": 8, "description": "Top-quality Phi-4 on Intel NPU. Excellent instruction following and tool use.", "vendor": "Intel"},
    {"alias": "phi-4-mini-reasoning", "device": "NPU", "tasks": ["chat"], "size_gb": 2.15, "model_id": "Phi-4-mini-reasoning-openvino-npu:3", "quality": 9, "speed": 7, "description": "Phi-4 reasoning variant on Intel NPU. Great for logic and math.", "vendor": "Intel"},
    {"alias": "qwen2.5-7b", "device": "NPU", "tasks": ["chat", "tools"], "size_gb": 4.17, "model_id": "qwen2.5-7b-instruct-openvino-npu:3", "quality": 8, "speed": 7, "description": "Versatile 7B model on Intel NPU. Strong at chat and function calling.", "vendor": "Intel"},
    {"alias": "qwen2.5-1.5b", "device": "NPU", "tasks": ["chat", "tools"], "size_gb": 0.86, "model_id": "qwen2.5-1.5b-instruct-openvino-npu:4", "quality": 6, "speed": 10, "description": "Fast and lightweight on Intel NPU. Good for quick tasks.", "vendor": "Intel"},
    {"alias": "qwen2.5-0.5b", "device": "NPU", "tasks": ["chat", "tools"], "size_gb": 0.32, "model_id": "qwen2.5-0.5b-instruct-openvino-npu:4", "quality": 5, "speed": 10, "description": "Tiny model, ultra-fast on Intel NPU. Drafting and simple Q&A.", "vendor": "Intel"},
    {"alias": "qwen2.5-coder-7b", "device": "NPU", "tasks": ["chat", "tools"], "size_gb": 4.17, "model_id": "qwen2.5-coder-7b-instruct-openvino-npu:3", "quality": 8, "speed": 7, "description": "Code-specialized 7B on Intel NPU. Best for programming tasks.", "vendor": "Intel"},
    {"alias": "qwen2.5-coder-1.5b", "device": "NPU", "tasks": ["chat", "tools"], "size_gb": 0.87, "model_id": "qwen2.5-coder-1.5b-instruct-openvino-npu:4", "quality": 6, "speed": 9, "description": "Lightweight coding assistant on Intel NPU.", "vendor": "Intel"},
    {"alias": "qwen2.5-coder-0.5b", "device": "NPU", "tasks": ["chat", "tools"], "size_gb": 0.32, "model_id": "qwen2.5-coder-0.5b-instruct-openvino-npu:4", "quality": 5, "speed": 10, "description": "Tiny coder on Intel NPU. Fast code completion.", "vendor": "Intel"},
    {"alias": "deepseek-r1-7b", "device": "NPU", "tasks": ["chat"], "size_gb": 4.17, "model_id": "DeepSeek-R1-Distill-Qwen-7B-openvino-npu:3", "quality": 8, "speed": 7, "description": "Strong reasoning model on Intel NPU. Excellent chain-of-thought.", "vendor": "Intel"},
    {"alias": "phi-3.5-mini", "device": "NPU", "tasks": ["chat"], "size_gb": 2.13, "model_id": "Phi-3-mini-4k-instruct-openvino-npu:2", "quality": 7, "speed": 9, "description": "Compact Phi-3 on Intel NPU. Efficient for conversational tasks.", "vendor": "Intel"},
    {"alias": "phi-3-mini-128k", "device": "NPU", "tasks": ["chat"], "size_gb": 2.13, "model_id": "Phi-3-mini-128k-instruct-openvino-npu:2", "quality": 7, "speed": 8, "description": "Phi-3 with 128K context on NPU. Great for long documents.", "vendor": "Intel"},
    {"alias": "mistral-7b-v0.2", "device": "NPU", "tasks": ["chat"], "size_gb": 3.60, "model_id": "Mistral-7B-Instruct-v0-2-openvino-npu:2", "quality": 7, "speed": 7, "description": "Classic Mistral on Intel NPU. Balanced performance.", "vendor": "Intel"},
    # NPU models — Qualcomm (QNN)
    {"alias": "qwen2.5-7b", "device": "NPU", "tasks": ["chat", "tools"], "size_gb": 2.78, "model_id": "qwen2.5-7b-instruct-qnn-npu:2", "quality": 8, "speed": 9, "description": "Best all-around Qualcomm NPU model. Great for chat and tool use.", "vendor": "Qualcomm"},
    {"alias": "qwen2.5-1.5b", "device": "NPU", "tasks": ["chat", "tools"], "size_gb": 2.78, "model_id": "qwen2.5-1.5b-instruct-qnn-npu:2", "quality": 6, "speed": 10, "description": "Fastest Qualcomm NPU model. Quick responses.", "vendor": "Qualcomm"},
    {"alias": "deepseek-r1-7b", "device": "NPU", "tasks": ["chat"], "size_gb": 3.71, "model_id": "deepseek-r1-distill-qwen-7b-qnn-npu:2", "quality": 8, "speed": 7, "description": "Reasoning model on Qualcomm NPU. Step-by-step thinking.", "vendor": "Qualcomm"},
    {"alias": "deepseek-r1-14b", "device": "NPU", "tasks": ["chat"], "size_gb": 7.12, "model_id": "deepseek-r1-distill-qwen-14b-qnn-npu:2", "quality": 9, "speed": 5, "description": "Most capable Qualcomm NPU reasoning model.", "vendor": "Qualcomm"},
    {"alias": "phi-3.5-mini", "device": "NPU", "tasks": ["chat"], "size_gb": 2.78, "model_id": "phi-3.5-mini-instruct-qnn-npu:2", "quality": 7, "speed": 9, "description": "Microsoft Phi on Qualcomm NPU. Compact and efficient.", "vendor": "Qualcomm"},
    {"alias": "phi-3-mini-128k", "device": "NPU", "tasks": ["chat"], "size_gb": 2.78, "model_id": "phi-3-mini-128k-instruct-qnn-npu:3", "quality": 7, "speed": 8, "description": "Long-context Phi-3 on Qualcomm NPU.", "vendor": "Qualcomm"},
    # GPU models
    {"alias": "phi-4-mini", "device": "GPU", "tasks": ["chat", "tools"], "size_gb": 3.72, "model_id": "Phi-4-mini-instruct-generic-gpu:5", "quality": 9, "speed": 8, "description": "Top-quality Phi-4 on GPU. Fast with dedicated graphics."},
    {"alias": "phi-4", "device": "GPU", "tasks": ["chat"], "size_gb": 8.37, "model_id": "Phi-4-generic-gpu:2", "quality": 10, "speed": 5, "description": "Best quality model on GPU. Deep reasoning and nuanced responses."},
    {"alias": "qwen2.5-14b", "device": "GPU", "tasks": ["chat", "tools"], "size_gb": 9.30, "model_id": "qwen2.5-14b-instruct-generic-gpu:4", "quality": 9, "speed": 4, "description": "Large 14B model on GPU. Excellent quality for complex tasks."},
    {"alias": "qwen2.5-coder-14b", "device": "GPU", "tasks": ["chat", "tools"], "size_gb": 8.79, "model_id": "qwen2.5-coder-14b-instruct-generic-gpu:4", "quality": 9, "speed": 4, "description": "Large 14B coding model on GPU. Best code generation quality."},
    {"alias": "deepseek-r1-14b", "device": "GPU", "tasks": ["chat"], "size_gb": 10.27, "model_id": "deepseek-r1-distill-qwen-14b-generic-gpu:4", "quality": 9, "speed": 4, "description": "Strong 14B reasoning model on GPU."},
    {"alias": "gpt-oss-20b", "device": "GPU", "tasks": ["chat"], "size_gb": 11.78, "model_id": "gpt-oss-20b-generic-gpu:1", "quality": 10, "speed": 3, "description": "Largest model. Best raw quality on GPU."},
    # CPU models
    {"alias": "phi-4-mini", "device": "CPU", "tasks": ["chat", "tools"], "size_gb": 4.80, "model_id": "Phi-4-mini-instruct-generic-cpu:5", "quality": 9, "speed": 6, "description": "Top-quality small model on CPU. Excellent instruction following."},
    {"alias": "phi-4", "device": "CPU", "tasks": ["chat"], "size_gb": 10.16, "model_id": "Phi-4-generic-cpu:2", "quality": 10, "speed": 3, "description": "Best quality CPU model. Deep reasoning and nuanced responses."},
    {"alias": "phi-4-mini-reasoning", "device": "CPU", "tasks": ["chat"], "size_gb": 4.52, "model_id": "Phi-4-mini-reasoning-generic-cpu:3", "quality": 9, "speed": 5, "description": "Phi-4 mini tuned for reasoning chains. Great for logic/math."},
    {"alias": "qwen2.5-7b", "device": "CPU", "tasks": ["chat", "tools"], "size_gb": 6.16, "model_id": "qwen2.5-7b-instruct-generic-cpu:4", "quality": 8, "speed": 5, "description": "Versatile 7B model. Strong at chat and function calling."},
    {"alias": "qwen2.5-14b", "device": "CPU", "tasks": ["chat", "tools"], "size_gb": 11.06, "model_id": "qwen2.5-14b-instruct-generic-cpu:4", "quality": 9, "speed": 3, "description": "Large 14B model on CPU. Best quality for complex tasks."},
    {"alias": "qwen2.5-0.5b", "device": "CPU", "tasks": ["chat", "tools"], "size_gb": 0.80, "model_id": "qwen2.5-0.5b-instruct-generic-cpu:4", "quality": 5, "speed": 10, "description": "Ultra-fast tiny model. Good for drafting and simple Q&A."},
    {"alias": "qwen2.5-coder-7b", "device": "CPU", "tasks": ["chat", "tools"], "size_gb": 6.16, "model_id": "qwen2.5-coder-7b-instruct-generic-cpu:4", "quality": 8, "speed": 5, "description": "Code-specialized 7B model. Best for programming tasks."},
    {"alias": "qwen2.5-coder-14b", "device": "CPU", "tasks": ["chat", "tools"], "size_gb": 11.06, "model_id": "qwen2.5-coder-14b-instruct-generic-cpu:4", "quality": 9, "speed": 3, "description": "Large 14B coding model on CPU."},
    {"alias": "qwen2.5-coder-1.5b", "device": "CPU", "tasks": ["chat", "tools"], "size_gb": 1.78, "model_id": "qwen2.5-coder-1.5b-instruct-generic-cpu:4", "quality": 6, "speed": 8, "description": "Lightweight coding assistant. Fast code completion."},
    {"alias": "qwen3-0.6b", "device": "CPU", "tasks": ["chat", "tools"], "size_gb": 0.58, "model_id": "qwen3-0.6b-generic-cpu:4", "quality": 5, "speed": 10, "description": "Latest Qwen tiny model. Impressive quality for its size."},
    {"alias": "gpt-oss-20b", "device": "CPU", "tasks": ["chat"], "size_gb": 12.26, "model_id": "gpt-oss-20b-generic-cpu:1", "quality": 10, "speed": 2, "description": "Largest available model. Best raw quality but requires patience."},
    {"alias": "deepseek-r1-7b", "device": "CPU", "tasks": ["chat"], "size_gb": 6.43, "model_id": "deepseek-r1-distill-qwen-7b-generic-cpu:4", "quality": 8, "speed": 5, "description": "Reasoning model on CPU. Good chain-of-thought responses."},
    {"alias": "deepseek-r1-14b", "device": "CPU", "tasks": ["chat"], "size_gb": 11.51, "model_id": "deepseek-r1-distill-qwen-14b-generic-cpu:4", "quality": 9, "speed": 3, "description": "Strong 14B reasoning model on CPU."},
    {"alias": "mistral-7b-v0.2", "device": "CPU", "tasks": ["chat"], "size_gb": 4.07, "model_id": "mistralai-Mistral-7B-Instruct-v0-2-generic-cpu:3", "quality": 7, "speed": 6, "description": "Classic instruction model. Balanced performance."},
    {"alias": "phi-3-mini-128k", "device": "CPU", "tasks": ["chat"], "size_gb": 2.54, "model_id": "Phi-3-mini-128k-instruct-generic-cpu:3", "quality": 7, "speed": 7, "description": "Phi-3 with 128K context. Great for long documents."},
    {"alias": "phi-3.5-mini", "device": "CPU", "tasks": ["chat"], "size_gb": 2.53, "model_id": "Phi-3.5-mini-instruct-generic-cpu:2", "quality": 7, "speed": 7, "description": "Compact Phi-3.5. Efficient conversational model."},
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
    "edgeai": {
        "title": "Edge AI Fundamentals", "icon": "🌐", "page": "edgeai",
        "levels": {
            100: {"title": "What Is Edge AI?", "duration": 3, "summary": "AI at the edge — local, private, and fast"},
            200: {"title": "Cloud vs Edge Trade-offs", "duration": 5, "summary": "When to process locally vs in the cloud"},
            300: {"title": "Edge AI Architecture", "duration": 8, "summary": "Designing local-first AI systems with NPU, GPU, and CPU"},
            400: {"title": "Production Edge Deployment", "duration": 12, "summary": "Scaling, monitoring, and hybrid cloud-edge patterns"},
        }
    },
    "slmfoundations": {
        "title": "SLM Model Families", "icon": "🧬", "page": "slmfoundations",
        "levels": {
            100: {"title": "Meet the Model Families", "duration": 3, "summary": "Phi, Qwen, Gemma, and more — the SLM landscape"},
            200: {"title": "Phi & Phi-Silica Deep Dive", "duration": 6, "summary": "Microsoft's Phi family and the NPU-native Phi-Silica"},
            300: {"title": "Qwen, Gemma & Open Models", "duration": 8, "summary": "Open-source SLMs from Alibaba, Google, and the community"},
            400: {"title": "BitNET & 1-bit Quantization", "duration": 10, "summary": "Revolutionary ultra-efficient models with ternary weights"},
        }
    },
    "optimization": {
        "title": "Model Optimization", "icon": "⚙️", "page": "optimization",
        "levels": {
            100: {"title": "Why Optimize Models?", "duration": 3, "summary": "Making AI models smaller, faster, and more efficient"},
            200: {"title": "Quantization Fundamentals", "duration": 6, "summary": "INT4, INT8, FP16 — precision vs performance trade-offs"},
            300: {"title": "Microsoft Olive & QNN", "duration": 10, "summary": "Hardware-aware optimization for NPU and CPU targets"},
            400: {"title": "Advanced Optimization Pipelines", "duration": 12, "summary": "Pruning, distillation, and end-to-end ONNX workflows"},
        }
    },
    "windowsml": {
        "title": "Windows ML & NPU Dev", "icon": "💻", "page": "windowsml",
        "levels": {
            100: {"title": "Windows AI Foundry Overview", "duration": 3, "summary": "Microsoft's platform for on-device AI development"},
            200: {"title": "DirectML & NPU Acceleration", "duration": 5, "summary": "How DirectML routes AI workloads to your NPU"},
            300: {"title": "Phi-Silica Integration", "duration": 8, "summary": "650 tokens/sec at 1.5W — building with the built-in model"},
            400: {"title": "Cross-Silicon Development", "duration": 10, "summary": "Writing apps that run on Qualcomm, Intel, AMD, and NVIDIA"},
        }
    },
    "agents": {
        "title": "AI Agents & Tools", "icon": "🤖", "page": "agents",
        "levels": {
            100: {"title": "What Are AI Agents?", "duration": 3, "summary": "Autonomous AI that reasons, plans, and uses tools"},
            200: {"title": "Function Calling Basics", "duration": 5, "summary": "Give your local model the ability to call functions"},
            300: {"title": "Multi-Agent Orchestration", "duration": 10, "summary": "Coordinate specialist agents for complex workflows"},
            400: {"title": "Production Agent Patterns", "duration": 12, "summary": "Human-in-the-loop, error recovery, and agent evaluation"},
        }
    },
    "foundrycloud": {
        "title": "Microsoft Foundry (Cloud)", "icon": "☁️", "page": "foundrycloud",
        "levels": {
            100: {"title": "What Is Microsoft Foundry?", "duration": 3, "summary": "Azure's AI platform for deploying and managing cloud models"},
            200: {"title": "Deploy Models & Model Router", "duration": 8, "summary": "Deploy GPT-4o, embeddings, and intelligent model routing"},
            300: {"title": "SDK Integration & Playground", "duration": 10, "summary": "Consume cloud models via Python SDK and test in Playground"},
            400: {"title": "Production Patterns & Optimization", "duration": 12, "summary": "Model Router strategies, cost optimization, and multi-model architectures"},
        }
    },
    "foundryagents": {
        "title": "Foundry Agent Service", "icon": "🕵️", "page": "foundryagents",
        "levels": {
            100: {"title": "Cloud Agents Overview", "duration": 3, "summary": "Prompt agents, workflow agents, and hosted agents in Foundry"},
            200: {"title": "Build Your First Cloud Agent", "duration": 8, "summary": "Create agents with AIProjectClient and the Agent Service"},
            300: {"title": "Multi-Agent Workflows & RAG", "duration": 12, "summary": "ConnectedAgentTool, Foundry IQ knowledge bases, and agentic retrieval"},
            400: {"title": "Hosted Agents & Production", "duration": 15, "summary": "Container-based agents, custom code, and end-to-end deployment"},
        }
    },
    "governance": {
        "title": "AI Gateway & Governance", "icon": "🛡️", "page": "governance",
        "levels": {
            100: {"title": "Why AI Governance?", "duration": 3, "summary": "Token limits, quotas, and cost control for AI workloads"},
            200: {"title": "Enable AI Gateway", "duration": 6, "summary": "Set up APIM-backed governance in the Foundry portal"},
            300: {"title": "Token Limits & Multi-Team Control", "duration": 8, "summary": "Configure per-project and per-agent token policies"},
            400: {"title": "Enterprise Governance Patterns", "duration": 10, "summary": "Compliance boundaries, custom agent governance, and MCP tool control"},
        }
    },
    "hybridai": {
        "title": "Hybrid AI", "icon": "🔀", "page": "hybridai",
        "levels": {
            100: {"title": "What Is Hybrid AI?", "duration": 3, "summary": "Combining cloud Foundry with on-device Copilot+ PC capabilities"},
            200: {"title": "Cloud-to-Edge Patterns", "duration": 6, "summary": "Train in the cloud, infer on the edge — practical architectures"},
            300: {"title": "Evaluators for Edge Models", "duration": 10, "summary": "Use Foundry evaluators to validate SLM quality on Copilot+ PCs"},
            400: {"title": "Production Hybrid Architecture", "duration": 12, "summary": "Building enterprise apps that span Foundry cloud and Surface NPUs"},
        }
    },
}

TOPIC_ORDER = ["hardware", "foundry", "models", "toolkit", "edgeai", "slmfoundations", "optimization", "windowsml", "agents", "foundrycloud", "foundryagents", "governance", "hybridai", "recall", "clicktodo", "semanticsearch"]


def recommend_models(has_npu: bool, ram_gb: int, vendor: str = "") -> dict:
    """Return task-based model recommendations."""
    recommendations = {}
    for task_key, profile in TASK_PROFILES.items():
        picks = []
        for model in FOUNDRY_MODELS:
            # Filter by available device
            if model["device"] == "NPU" and not has_npu:
                continue
            # Filter NPU models by silicon vendor
            if model["device"] == "NPU" and model.get("vendor") and vendor and model["vendor"] != vendor:
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

@app.get("/health")
async def health():
    """Lightweight health endpoint — responds instantly for WaitForServerAsync."""
    return {"status": "ok"}


@app.get("/", response_class=HTMLResponse)
async def root():
    with open(BASE_DIR / "static" / "index.html", encoding="utf-8") as f:
        return f.read()


@app.get("/api/hardware")
def api_hardware():
    hw = detect_hardware()
    return hw


@app.get("/api/models")
def api_models():
    hw = detect_hardware()
    recs = recommend_models(hw["summary"]["has_npu"], hw["ram_gb"], hw["summary"]["silicon_vendor"])
    return {"hardware": hw, "recommendations": recs}


@app.get("/api/foundry/status")
def api_foundry_status():
    base = get_foundry_base_url()
    if not base:
        return {"status": "offline", "url": None}
    try:
        r = httpx.get(f"{base}/v1/models", timeout=5)
        models = r.json().get("data", [])
        return {"status": "online", "url": base, "loaded_models": [m["id"] for m in models]}
    except Exception:
        base2 = get_foundry_base_url(force_refresh=True)
        if base2:
            try:
                r = httpx.get(f"{base2}/v1/models", timeout=5)
                models = r.json().get("data", [])
                return {"status": "online", "url": base2, "loaded_models": [m["id"] for m in models]}
            except Exception:
                pass
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
    try:
        body = await request.json()
    except Exception:
        return {"error": "Invalid JSON in request body"}

    messages = body.get("messages", [])
    model_id = body.get("model")

    # Guard against empty messages
    if not messages or not any(m.get("content", "").strip() for m in messages if m.get("role") == "user"):
        return {"error": "No message content provided"}

    base = await asyncio.to_thread(get_foundry_base_url)
    if not base:
        return {"error": "Foundry Local service not running. Start it with: foundry service start"}

    # Build system prompt for Apollo
    # NOTE: Keep this compact — Foundry Local NPU streaming drops the connection
    # if the system prompt consumes too many input tokens (~1000+).
    system_msg = {
        "role": "system",
        "content": (
            "You are Apollo 🚀, the AI mission commander at Surface AI Launchpad — "
            "mission control for on-device AI across CPU, GPU, and NPU on Windows Copilot+ PCs.\n\n"
            "Speak with confident, friendly mission-commander energy and stay practical. You know:\n"
            "- Edge AI, NPU vs CPU vs GPU, TOPS, power efficiency\n"
            "- SLMs: Phi-4, Qwen, Gemma, Phi-Silica (650 tok/s at 1.5W), BitNET\n"
            "- Foundry Local CLI, OpenAI-compatible API, and SDKs (Python, JS, C#, Rust)\n"
            "- Model optimization: quantization (INT4/INT8), Olive, QNN, ONNX Runtime\n"
            "- Windows ML, DirectML, Windows AI Foundry, Foundry Toolkit for VS Code\n"
            "- AI agents, function calling, multi-agent orchestration\n"
            "- Microsoft Foundry (cloud), Model Router, Foundry Agent Service, Foundry IQ\n"
            "- AI Gateway & governance, hybrid cloud-edge patterns\n"
            "- Windows NPU features: Recall, Click to Do, Semantic Search, Super Resolution\n"
            "- NPU Value: Built In (Windows features) / Bolt On (ISV apps) / Build Your Own (custom solutions)\n\n"
            "Style: match depth to level (100-400), give practical examples and CLI commands, "
            "be encouraging, end with a 'Try this!' suggestion. Keep answers concise. Use markdown."
        )
    }

    full_messages = [system_msg] + messages

    async def stream_response():
        try:
            timeout = httpx.Timeout(10.0, read=180.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
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
        except (httpx.RemoteProtocolError, httpx.ReadError):
            yield 'data: {"choices":[{"delta":{"content":"\\n\\n*[Connection to Foundry Local was interrupted. The model may be reloading — try again in a moment.]*"}}]}\n\n'
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f'data: {{"choices":[{{"delta":{{"content":"\\n\\n*[An error occurred: {str(e)}]*"}}}}]}}\n\n'
            yield "data: [DONE]\n\n"

    return StreamingResponse(stream_response(), media_type="text/event-stream")


@app.post("/api/transcribe")
def api_transcribe(audio: UploadFile = File(...)):
    """Transcribe audio using on-device speech recognition (runs in thread pool)."""
    if not _ensure_stt():
        return JSONResponse({"error": "Speech recognition not available — install SpeechRecognition and pydub"}, status_code=503)

    tmp_path = None
    wav_path = None
    try:
        suffix = Path(audio.filename).suffix if audio.filename else ".webm"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = tmp.name
            content = audio.file.read()
            tmp.write(content)

        # Convert to WAV for SpeechRecognition (handles webm, ogg, mp4, etc.)
        wav_path = tmp_path + ".wav"
        audio_seg = AudioSegment.from_file(tmp_path)
        audio_seg.export(wav_path, format="wav")

        t0 = time.perf_counter()
        recognizer = sr.Recognizer()
        with sr.AudioFile(wav_path) as source:
            audio_data = recognizer.record(source)

        text = recognizer.recognize_google(audio_data)
        elapsed_ms = round((time.perf_counter() - t0) * 1000)

        return {
            "text": text,
            "latency_ms": elapsed_ms,
            "duration_s": round(len(audio_seg) / 1000, 1),
        }
    except sr.UnknownValueError:
        return {"text": "", "latency_ms": 0, "duration_s": 0}
    except sr.RequestError as exc:
        return JSONResponse({"error": f"Speech recognition service error: {exc}"}, status_code=503)
    except Exception as exc:
        return JSONResponse({"error": f"Transcription failed: {exc}"}, status_code=500)
    finally:
        for p in (tmp_path, wav_path):
            if p:
                try:
                    os.unlink(p)
                except OSError:
                    pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8080)
