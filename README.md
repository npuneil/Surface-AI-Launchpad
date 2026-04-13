# NPUniversity 🎓

A virtual campus for learning on-device AI with Windows Copilot+ PCs. Featuring **Professor NPU** — your personal AI tour guide who builds custom lesson plans based on your available time and desired depth.

## Quick Start

```powershell
cd npu-getting-started
pip install -r requirements.txt
python app.py
```

Then open **http://127.0.0.1:8080** in your browser.

## Prerequisites

- **Python 3.10+**
- **Foundry Local** installed (`winget install Microsoft.FoundryLocal`)
- Foundry service running (`foundry service start`) — needed for Professor NPU chat

## Professor NPU

The floating 🎓 avatar in the bottom-right corner is your AI learning guide. Tell Professor NPU:

1. **How much time you have** (15, 30, 45, 60, or 90 minutes)
2. **Your course level** (100=Intro, 200=Fundamentals, 300=Intermediate, 400=Advanced)

Professor NPU builds a custom lesson plan maximizing your learning time, then walks you through each topic with contextual tips and the ability to ask questions.

## Course Content

| Level | Description |
|-------|-------------|
| **100** | Introduction — no prior knowledge assumed |
| **200** | Fundamentals — getting started, first steps |
| **300** | Intermediate — deeper understanding, APIs, configuration |
| **400** | Advanced — architecture, optimization, building apps |

## Topics Covered

| Topic | Description |
|-------|-------------|
| **Hardware Detection** | CPU, GPU, NPU detection and AI capability analysis |
| **Model Recommendations** | Task-based SLM picks optimized for your hardware |
| **Foundry Local** | Setup guide, CLI commands, API examples |
| **AI Toolkit** | VS Code extension for model testing and fine-tuning |
| **Recall** | NPU-powered screen memory and search |
| **Click to Do** | Context-aware AI actions on screen content |
| **Semantic Search** | Meaning-based file search powered by NPU |
