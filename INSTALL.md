# Installing Surface AI Launchpad

Surface AI Launchpad runs entirely on your PC — no cloud, no account, no data leaves your device.

## Step 1 — Pick the right download for your PC

Not sure which one you have? Press `Windows + Pause/Break` (or open **Settings → System → About**) and look at **System type**:

| You see... | Download |
|---|---|
| **ARM-based processor** (Snapdragon X / X Elite, Surface Pro 11, Surface Laptop 7) | **`SurfaceAILaunchpad-Snapdragon-v1.4.0.zip`** |
| **x64-based processor** (Intel Core, AMD Ryzen) | **`SurfaceAILaunchpad-Intel-v1.4.0.zip`** |

> 💡 Snapdragon PCs get faster, more efficient on-device AI thanks to the built-in NPU. Intel/AMD x64 devices fall back to CPU/GPU and still work great.

## Step 2 — Unzip and run the installer

1. **Right-click the downloaded `.zip`** → **Extract All…** → click **Extract**.
2. Open the extracted folder.
3. **Double-click `Install-SurfaceAILaunchpad.bat`**.
4. Click **Yes** when Windows asks for permission (one-time, to trust the signing certificate).
5. Wait ~10 seconds — the installer will finish and launch Surface AI Launchpad automatically.

That's it. Surface AI Launchpad is now in your Start menu — just type "Surface AI Launchpad" any time you want to launch it.

---

## What the installer does (for the curious)

1. Detects whether your PC is Snapdragon or Intel/AMD
2. Trusts the included signing certificate (one-time)
3. Installs the matching `.msix` package
4. Launches the app

You can uninstall any time from **Settings → Apps → Installed apps → Surface AI Launchpad**.

## First launch — what to expect

The first time you run Surface AI Launchpad, a setup screen will check your PC for the components it needs:

- ✅ **Microsoft Edge WebView2** — for the in-app browser (almost always already installed)
- ✅ **Python 3.10+** — for the local AI backend
- ✅ **Visual C++ Runtime** — required by the AI libraries
- ✅ **Foundry Local** — Microsoft''s on-device AI engine
- ✅ **NPU drivers** — auto-detected for your chip (Qualcomm, Intel, or AMD)
- ✅ **AI model** — downloaded once (~2–4 GB), then cached forever

If anything is missing, click **Install** next to it. If everything''s green, click **Continue**. Setup happens once per machine.

## Troubleshooting

**"Windows protected your PC" / SmartScreen warning**
Click **More info** → **Run anyway**. The app is signed with a self-signed certificate (free), which SmartScreen doesn''t recognize on first launch. You''ll only see this once.

**"This app can''t run on your PC"**
You probably grabbed the wrong zip. Snapdragon PCs need the ARM64 version; Intel/AMD need the x64 version. See Step 1.

**The setup screen says something is missing and the Install button doesn''t work**
Open the link shown next to the missing item to install it manually, then click the **Re-check** button.

**The app shows "Server failed to start"**
The error message now includes the last lines of backend output. Copy that and open an issue at https://github.com/npuneil/Surface-AI-Launchpad/issues — we''ll fix it.
