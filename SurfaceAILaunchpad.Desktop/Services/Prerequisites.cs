#nullable enable
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace SurfaceAILaunchpad.Desktop.Services;

/// <summary>
/// State of a single prerequisite at check-time.
/// </summary>
public enum PrereqState
{
    Unknown,
    Checking,
    Installed,
    Missing,
    Installing,
    Failed,
    NotApplicable
}

public sealed class PrereqItem
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string Description { get; init; }
    public bool Required { get; init; } = true;
    /// <summary>Winget package ID used for install.</summary>
    public string? WingetId { get; init; }
    /// <summary>Optional fallback URL shown when winget is unavailable.</summary>
    public string? DocsUrl { get; init; }
    public PrereqState State { get; set; } = PrereqState.Unknown;
    public string? Detail { get; set; }
}

public enum NpuVendor { None, Qualcomm, Intel, AMD }

/// <summary>
/// Detects and installs runtime prerequisites for Surface AI Launchpad:
/// Python 3.10+, Foundry Local, NPU runtime/driver, an NPU-optimized model,
/// and the Microsoft Visual C++ runtime (required by some Foundry providers).
/// </summary>
public static class Prerequisites
{
    public static NpuVendor DetectNpuVendor()
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(
                @"HARDWARE\DESCRIPTION\System\CentralProcessor\0");
            var name = key?.GetValue("ProcessorNameString") as string ?? "";
            if (name.Contains("Snapdragon", StringComparison.OrdinalIgnoreCase) ||
                name.Contains("Qualcomm", StringComparison.OrdinalIgnoreCase) ||
                name.Contains("Oryon", StringComparison.OrdinalIgnoreCase))
                return NpuVendor.Qualcomm;
            if (name.Contains("Core(TM) Ultra", StringComparison.OrdinalIgnoreCase) ||
                name.Contains("Core Ultra", StringComparison.OrdinalIgnoreCase))
                return NpuVendor.Intel;
            if (name.Contains("Ryzen AI", StringComparison.OrdinalIgnoreCase) ||
                name.Contains("Ryzen", StringComparison.OrdinalIgnoreCase) && name.Contains("HX"))
                return NpuVendor.AMD;
        }
        catch { }
        return NpuVendor.None;
    }

    public static List<PrereqItem> BuildList()
    {
        var npu = DetectNpuVendor();
        var npuDescription = npu switch
        {
            NpuVendor.Qualcomm => "Snapdragon NPU detected — Foundry Local will use the QNN execution provider for NPU acceleration.",
            NpuVendor.Intel => "Intel Core Ultra detected — Foundry Local will use the OpenVINO execution provider for NPU acceleration.",
            NpuVendor.AMD => "AMD Ryzen AI detected — Foundry Local will use the Ryzen AI / VitisAI execution provider for NPU acceleration.",
            _ => "No supported NPU detected. Surface AI Launchpad will fall back to CPU models. A Copilot+ PC (Snapdragon X / Core Ultra / Ryzen AI) is recommended."
        };

        return new List<PrereqItem>
        {
            new()
            {
                Id = "webview2",
                Name = "Microsoft Edge WebView2 Runtime",
                Description = "Renders the Surface AI Launchpad UI inside the desktop app.",
                Required = true,
                WingetId = "Microsoft.EdgeWebView2Runtime",
                DocsUrl = "https://developer.microsoft.com/microsoft-edge/webview2/"
            },
            new()
            {
                Id = "python",
                Name = "Python 3.10+",
                Description = "Runs the FastAPI backend that powers Surface AI Launchpad.",
                Required = true,
                WingetId = "Python.Python.3.12",
                DocsUrl = "https://www.python.org/downloads/"
            },
            new()
            {
                Id = "vcredist",
                Name = "Visual C++ Runtime (2015–2022)",
                Description = "Required by Foundry Local's native ONNX/QNN/OpenVINO providers.",
                Required = true,
                WingetId = "Microsoft.VCRedist.2015+.x64",
                DocsUrl = "https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist"
            },
            new()
            {
                Id = "foundry",
                Name = "Microsoft Foundry Local",
                Description = "On-device model runtime that hosts SLMs on your NPU/GPU/CPU.",
                Required = true,
                WingetId = "Microsoft.FoundryLocal",
                DocsUrl = "https://learn.microsoft.com/azure/ai-foundry/foundry-local/"
            },
            new()
            {
                Id = "npu",
                Name = $"NPU Runtime ({NpuLabel(npu)})",
                Description = npuDescription,
                Required = false,
                DocsUrl = npu switch
                {
                    NpuVendor.Qualcomm => "https://www.qualcomm.com/developer/windows-on-snapdragon",
                    NpuVendor.Intel => "https://www.intel.com/content/www/us/en/support/articles/000097597",
                    NpuVendor.AMD => "https://www.amd.com/en/products/ryzen-ai",
                    _ => "https://learn.microsoft.com/windows/ai/npu-devices/"
                }
            },
            new()
            {
                Id = "model",
                Name = "NPU-optimized model",
                Description = "Pulls the best SLM for your detected accelerator (Phi-4-mini for Intel, Phi-3.5-mini for Qualcomm).",
                Required = false,
                DocsUrl = "https://learn.microsoft.com/azure/ai-foundry/foundry-local/concepts/foundry-local-architecture"
            }
        };
    }

    static string NpuLabel(NpuVendor v) => v switch
    {
        NpuVendor.Qualcomm => "QNN",
        NpuVendor.Intel => "OpenVINO",
        NpuVendor.AMD => "Ryzen AI",
        _ => "CPU fallback"
    };

    // ---------- Detection ----------

    public static async Task CheckAsync(PrereqItem item)
    {
        item.State = PrereqState.Checking;
        try
        {
            switch (item.Id)
            {
                case "webview2":
                    var wv2 = DetectWebView2();
                    item.State = wv2 ? PrereqState.Installed : PrereqState.Missing;
                    item.Detail = wv2 ? "WebView2 Runtime installed" : "Runtime not installed";
                    break;

                case "python":
                    var (ok, ver) = TryDetectPython();
                    item.State = ok ? PrereqState.Installed : PrereqState.Missing;
                    item.Detail = ok ? $"Detected {ver}" : "Not found on PATH";
                    break;

                case "vcredist":
                    var vc = DetectVcRedist();
                    item.State = vc ? PrereqState.Installed : PrereqState.Missing;
                    item.Detail = vc ? "Installed" : "Not installed";
                    break;

                case "foundry":
                    var foundryOk = await DetectFoundryAsync();
                    item.State = foundryOk ? PrereqState.Installed : PrereqState.Missing;
                    item.Detail = foundryOk ? "foundry CLI available" : "foundry CLI not found";
                    break;

                case "npu":
                    var vendor = DetectNpuVendor();
                    item.State = vendor == NpuVendor.None ? PrereqState.NotApplicable : PrereqState.Installed;
                    item.Detail = vendor == NpuVendor.None
                        ? "No NPU — CPU fallback will be used"
                        : $"{vendor} NPU detected";
                    break;

                case "model":
                    var modelOk = await DetectModelAsync();
                    item.State = modelOk ? PrereqState.Installed : PrereqState.Missing;
                    item.Detail = modelOk ? "Model cached locally" : "No NPU/CPU SLM cached yet";
                    break;
            }
        }
        catch (Exception ex)
        {
            item.State = PrereqState.Failed;
            item.Detail = ex.Message;
        }
    }

    public static (bool ok, string? version) TryDetectPython()
    {
        foreach (var (exe, args) in new[] { ("py", "-3 --version"), ("python", "--version"), ("python3", "--version") })
        {
            try
            {
                var psi = new ProcessStartInfo(exe, args)
                {
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using var p = Process.Start(psi);
                if (p == null) continue;
                p.WaitForExit(5000);
                var output = (p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd()).Trim();
                var m = Regex.Match(output, @"Python\s+(\d+)\.(\d+)\.(\d+)");
                if (m.Success)
                {
                    var major = int.Parse(m.Groups[1].Value);
                    var minor = int.Parse(m.Groups[2].Value);
                    if (major > 3 || (major == 3 && minor >= 10))
                        return (true, output);
                }
            }
            catch { }
        }
        return (false, null);
    }

    static bool DetectWebView2()
    {
        try
        {
            const string clientId = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
            string[] paths = {
                $@"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{clientId}",
                $@"SOFTWARE\Microsoft\EdgeUpdate\Clients\{clientId}"
            };
            foreach (var p in paths)
            {
                using var key = Registry.LocalMachine.OpenSubKey(p);
                var pv = key?.GetValue("pv") as string;
                if (!string.IsNullOrEmpty(pv) && pv != "0.0.0.0") return true;
            }
            using var hkcu = Registry.CurrentUser.OpenSubKey(
                $@"Software\Microsoft\EdgeUpdate\Clients\{clientId}");
            var pvUser = hkcu?.GetValue("pv") as string;
            return !string.IsNullOrEmpty(pvUser) && pvUser != "0.0.0.0";
        }
        catch { return false; }
    }

    static bool DetectVcRedist()
    {
        // Installed VCRedist 14+ writes here.
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(
                @"SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64") ??
                Registry.LocalMachine.OpenSubKey(
                @"SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64");
            if (key == null) return false;
            var installed = key.GetValue("Installed");
            return installed is int i && i == 1;
        }
        catch { return false; }
    }

    static async Task<bool> DetectFoundryAsync()
    {
        // Route through cmd /c so the foundry App Execution Alias resolves from a packaged process.
        try
        {
            var psi = new ProcessStartInfo("cmd.exe", "/c \"foundry --version\"")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using var p = Process.Start(psi);
            if (p == null) return false;
            using var cts = new System.Threading.CancellationTokenSource(TimeSpan.FromSeconds(10));
            try { await p.WaitForExitAsync(cts.Token); }
            catch (OperationCanceledException) { try { p.Kill(true); } catch { } return false; }
            return p.ExitCode == 0;
        }
        catch { return false; }
    }

    static async Task<bool> DetectModelAsync()
    {
        // Use `foundry cache list` (cli) to check locally cached models.
        // Routed through cmd /c for App Execution Alias resolution.
        try
        {
            var psi = new ProcessStartInfo("cmd.exe", "/c \"foundry cache list\"")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using var p = Process.Start(psi);
            if (p == null) return false;
            using var cts = new System.Threading.CancellationTokenSource(TimeSpan.FromSeconds(15));
            string stdout;
            try
            {
                stdout = await p.StandardOutput.ReadToEndAsync(cts.Token);
                await p.WaitForExitAsync(cts.Token);
            }
            catch (OperationCanceledException) { try { p.Kill(true); } catch { } return false; }
            // If the user has any Phi / Qwen / Llama variant cached, count it as ready.
            return Regex.IsMatch(stdout, @"(Phi-3|Phi-4|qwen|Llama|deepseek|mistral)", RegexOptions.IgnoreCase);
        }
        catch { return false; }
    }

    // ---------- Install ----------

    public static async Task InstallAsync(PrereqItem item, Action<string>? log = null)
    {
        item.State = PrereqState.Installing;
        try
        {
            switch (item.Id)
            {
                case "webview2":
                case "python":
                case "vcredist":
                case "foundry":
                    if (item.WingetId == null) { item.State = PrereqState.Missing; return; }
                    var ok = await RunWingetInstallAsync(item.WingetId, log);
                    item.State = ok ? PrereqState.Installed : PrereqState.Failed;
                    item.Detail = ok ? "Installed via winget" : "winget install failed — see logs";
                    break;

                case "model":
                    var modelOk = await PullDefaultModelAsync(log);
                    item.State = modelOk ? PrereqState.Installed : PrereqState.Failed;
                    item.Detail = modelOk ? "Model downloaded" : "Download failed — try `foundry model run` manually";
                    break;

                case "npu":
                    // No automated install — vendor driver. Just refresh detection.
                    await CheckAsync(item);
                    break;
            }
        }
        catch (Exception ex)
        {
            item.State = PrereqState.Failed;
            item.Detail = ex.Message;
            log?.Invoke($"[ERROR] {ex.Message}");
        }
    }

    static async Task<bool> RunWingetInstallAsync(string id, Action<string>? log)
    {
        // Winget is an App Execution Alias (shim under %LOCALAPPDATA%\Microsoft\WindowsApps).
        // From inside a packaged WinUI app, Process.Start("winget", ...) often fails to
        // resolve the alias. Routing through `cmd /c` lets the shell expand the alias
        // the same way a normal terminal does.
        var args = $"install --id {id} -e --silent --accept-package-agreements --accept-source-agreements";
        log?.Invoke($"> winget {args}");
        return await RunShellCommandAsync("winget", args, log);
    }

    /// <summary>
    /// Runs `cmd /c <tool> <args>` so App Execution Aliases (winget, foundry, etc.)
    /// resolve correctly from a packaged process. Returns true on exit code 0
    /// (or winget's "already installed" code 0x8A15002B).
    /// </summary>
    static async Task<bool> RunShellCommandAsync(string tool, string args, Action<string>? log)
    {
        var cmdArgs = $"/c \"{tool} {args}\"";
        var psi = new ProcessStartInfo("cmd.exe", cmdArgs)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        try
        {
            using var p = Process.Start(psi);
            if (p == null)
            {
                log?.Invoke($"[ERROR] Could not start cmd.exe for '{tool}'");
                return false;
            }
            p.OutputDataReceived += (_, e) => { if (e.Data != null) log?.Invoke(e.Data); };
            p.ErrorDataReceived += (_, e) => { if (e.Data != null) log?.Invoke(e.Data); };
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            await p.WaitForExitAsync();
            int exit = p.ExitCode;
            log?.Invoke($"[exit {exit}] {tool}");
            // 0 = success. winget returns -1978335189 (0x8A15002B) when the package is already installed.
            return exit == 0 || (uint)exit == 0x8A15002B;
        }
        catch (Exception ex)
        {
            log?.Invoke($"[ERROR] {tool}: {ex.Message}");
            return false;
        }
    }

    static async Task<bool> PullDefaultModelAsync(Action<string>? log)
    {
        var vendor = DetectNpuVendor();
        // Foundry Local accepts an alias and picks the optimal variant for the device.
        // phi-4-mini is only available as OpenVINO (Intel) and CPU/GPU — no QNN variant
        // exists, so Qualcomm devices use phi-3.5-mini (best available QNN model).
        string alias = vendor switch
        {
            NpuVendor.Qualcomm => "phi-3.5-mini",
            _ => "phi-4-mini"
        };
        string deviceArg = vendor switch
        {
            NpuVendor.Qualcomm => "--device NPU",
            NpuVendor.Intel => "--device NPU",
            NpuVendor.AMD => "--device NPU",
            _ => "--device CPU"
        };

        var args = $"model download {alias} {deviceArg}";
        log?.Invoke($"> foundry {args}");
        return await RunShellCommandAsync("foundry", args, log);
    }
}
