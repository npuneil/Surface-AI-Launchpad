# Surface AI Launchpad — On-Device AI Mission Control 🚀

> ⚠️ **DEMO / SAMPLE CODE — NOT A PRODUCT.** Surface AI Launchpad (formerly NPUniversity) is an experimental
> prototype provided for educational and demonstration purposes only. It is
> **not** a Microsoft product and is **not** supported, warranted, or
> production-ready. See the [On-Device AI Prototypes & Sample Code](#on-device-ai-prototypes--sample-code)
> section below for the full disclaimers — by downloading, installing, or
> running the MSIX you accept those terms.

Mission control for learning and shipping on-device AI across CPU, GPU, and NPU on Copilot+ PCs — guided by "Apollo", an AI mission commander that adapts briefings by skill level. Running locally via Microsoft Foundry Local.

> 🛰️ **Note on the rebrand.** As of v1.1.0, project files, namespace, MSIX identity, and installer are all renamed to `SurfaceAILaunchpad`. Older releases on disk may still reference the old `NPUniversity` package name — uninstall those before installing v1.1.0+.

## Download & Install (Windows 11, ARM64 / Snapdragon Copilot+ PC)

The packaged MSIX is published as a GitHub Release:

➡️ **[Download the latest MSIX from Releases](https://github.com/npuneil/Surface-AI-Launchpad/releases/latest)**

Because this is a demo, the MSIX is signed with a self-signed certificate.
You must (1) install the certificate as trusted, then (2) sideload the MSIX:

1. Enable Developer Mode (one-time): `Settings → System → For developers → Developer Mode = On`.
2. Download `SurfaceAILaunchpad-<version>-<arch>.msix` **and** `SurfaceAILaunchpad.cer` from the release page (`<arch>` is `arm64` for Snapdragon, `x64` for Intel/AMD).
3. From an **elevated** PowerShell, trust the cert (one-time):
   ```powershell
   Import-Certificate -FilePath .\SurfaceAILaunchpad.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
   ```
4. Install the app (no admin needed once cert is trusted):
   ```powershell
   Add-AppxPackage .\SurfaceAILaunchpad-<version>-<arch>.msix
   ```
4. Launch **Surface AI Launchpad** from the Start menu. The first-run screen detects
   your NPU and installs missing prerequisites (Foundry Local, Python 3.12,
   VC++ runtime, an NPU-optimized Phi-4-mini model) via `winget`.

> The MSIX, the bundled prerequisite installer, and the model it pulls are all
> part of the demo. You are responsible for reviewing the third-party tools
> being installed (Python, Foundry Local, VC++ runtime, model weights) and the
> licenses they ship under before installing on a managed device.

## On-Device AI Prototypes & Sample Code

### Overview

This repository contains prototypes, demos, and sample code that illustrate patterns for building on-device AI solutions. The content is provided for educational and demonstration purposes only to help developers explore ideas and implementation approaches.

This repository does not contain Microsoft products and is not a supported or production-ready offering.

### Prototype & Sample Code Disclosure

- All code and demos are experimental prototypes or samples.
- They may be incomplete, change without notice, or be removed at any time.
- The contents are provided "as-is," without warranties or guarantees of any kind.

### No Product, Performance, or Business Claims

- This repository makes no claims about performance, accuracy, productivity, efficiency, cost savings, reliability, or security.
- Any example outputs, screenshots, or logs are illustrative only and should not be interpreted as typical or expected results.

### AI Output Variability

- AI and machine-learning outputs may be non-deterministic, incomplete, or incorrect.
- Example outputs shown here are not guaranteed and may vary across runs, devices, or environments.

### Responsible AI Considerations

- These samples are intended to demonstrate technical patterns, not validated AI systems.
- Developers are responsible for evaluating fairness, reliability, privacy, accessibility, and safety before using similar approaches in real applications.
- Do not deploy AI solutions based on this code without appropriate testing, human oversight, and safeguards.

### Data & Fictitious Content

- Any names, data, or scenarios used in examples are fictitious and for illustration only.
- Do not use real personal, customer, or confidential data without proper authorization and protections.

### Third-Party Components

- The repository may reference third-party libraries or tools.
- Use of those components is subject to their respective licenses and terms.

### No Support

Microsoft does not provide support, SLAs, or warranties for the contents of this repository.

### Summary

By using this repository, you acknowledge that it contains illustrative prototypes and sample code only, not supported or production-ready software.

---

## Quick Start

```powershell
# Run directly:
python app.py      # opens at http://localhost:8080

# Or via Docker:
docker build -t npuniversity .
docker run -p 8080:8080 npuniversity
```

## Prerequisites

- **Windows 11 Copilot+ PC** with Snapdragon X or Intel Core Ultra NPU
- **Python 3.10+** (ARM64-native recommended for Snapdragon)
- **Foundry Local** installed (`winget install Microsoft.FoundryLocal`)

## Course Catalog

| Level | Topics |
|-------|--------|
| **100 — Foundations** | Hardware Detection, Model Recommendations, Foundry Local, AI Toolkit |
| **200 — Development** | Recall, Click to Do, Semantic Search, Edge AI |
| **300 — Advanced** | SLM Families, Model Optimization, Windows ML, AI Agents |
| **400 — Enterprise** | Foundry Cloud, Agent Service, AI Gateway, Hybrid AI |

## Features

| Feature | Description |
|---------|-------------|
| **Apollo** | AI mission commander that adapts explanations to your skill level |
| **16+ Topics** | Comprehensive curriculum from hardware basics to enterprise patterns |
| **Interactive Lessons** | Each topic includes overview, hands-on exercises, and quizzes |
| **Skill Tracking** | Progress tracking across all course levels |

## Demo Experience

Launch the app and explore topics across the four course levels. Apollo adjusts explanations based on your background — from beginner-friendly overviews to deep technical dives.
