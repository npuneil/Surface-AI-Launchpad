#nullable enable
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using NPUniversity.Desktop.Controls;
using NPUniversity.Desktop.Services;

namespace NPUniversity.Desktop;

public sealed partial class MainWindow : Window
{
    private Process? _pythonProcess;
    private readonly System.Text.StringBuilder _backendLog = new();
    private const int ServerPort = 8099;
    private const string ServerUrl = "http://127.0.0.1:8099";

    private readonly List<PrereqItem> _prereqs = new();
    private readonly Dictionary<string, PrereqRow> _rows = new();

    public MainWindow()
    {
        this.InitializeComponent();
        this.Title = "NPUniversity — Your On-Device AI Campus";
        this.AppWindow.Resize(new Windows.Graphics.SizeInt32(1400, 900));

        this.Closed += OnWindowClosed;
        _ = RunFirstRunAsync();
    }

    // ---------------- Prereq flow ----------------

    private async Task RunFirstRunAsync()
    {
        PrereqOverlay.Visibility = Visibility.Visible;
        LoadingOverlay.Visibility = Visibility.Collapsed;

        _prereqs.Clear();
        _prereqs.AddRange(Prerequisites.BuildList());

        var vendor = Prerequisites.DetectNpuVendor();
        PrereqBannerTitle.Text = vendor switch
        {
            NpuVendor.Qualcomm => "Snapdragon NPU detected",
            NpuVendor.Intel => "Intel Core Ultra NPU detected",
            NpuVendor.AMD => "AMD Ryzen AI NPU detected",
            _ => "No NPU detected"
        };
        PrereqBannerMessage.Text = vendor == NpuVendor.None
            ? "NPUniversity will run on CPU. For best performance use a Copilot+ PC."
            : $"Foundry Local will accelerate models on the {vendor} NPU.";
        PrereqBanner.Background = new Microsoft.UI.Xaml.Media.SolidColorBrush(
            vendor == NpuVendor.None
                ? Windows.UI.Color.FromArgb(0xFF, 0x5a, 0x3a, 0x1a)
                : Windows.UI.Color.FromArgb(0xFF, 0x1a, 0x3a, 0x5a));

        PrereqList.Children.Clear();
        _rows.Clear();
        foreach (var item in _prereqs)
        {
            var row = new PrereqRow();
            row.Bind(item);
            row.ActionRequested += OnRowAction;
            _rows[item.Id] = row;
            PrereqList.Children.Add(row);
        }

        await CheckAllAsync();
    }

    private async Task CheckAllAsync()
    {
        var tasks = _prereqs.Select(async item =>
        {
            await Prerequisites.CheckAsync(item);
            DispatcherQueue.TryEnqueue(() => _rows[item.Id].Refresh());
        });
        await Task.WhenAll(tasks);
        UpdateContinueState();
    }

    private void UpdateContinueState()
    {
        bool requiredOk = _prereqs
            .Where(p => p.Required)
            .All(p => p.State == PrereqState.Installed || p.State == PrereqState.NotApplicable);
        ContinueButton.IsEnabled = requiredOk;

        bool anyMissing = _prereqs.Any(p => p.State == PrereqState.Missing && (p.WingetId != null || p.Id == "model"));
        InstallAllButton.IsEnabled = anyMissing;
    }

    private async void OnRowAction(object? sender, PrereqItem item)
    {
        if (item.State == PrereqState.Installed)
        {
            await Prerequisites.CheckAsync(item);
        }
        else if (item.State == PrereqState.NotApplicable && item.DocsUrl != null)
        {
            OpenUrl(item.DocsUrl);
            return;
        }
        else if (item.WingetId == null && item.Id != "model")
        {
            if (item.DocsUrl != null) OpenUrl(item.DocsUrl);
            return;
        }
        else
        {
            await Prerequisites.InstallAsync(item, AppendLog);
            await Prerequisites.CheckAsync(item);
        }

        _rows[item.Id].Refresh();
        UpdateContinueState();
    }

    private async void OnInstallAll(object sender, RoutedEventArgs e)
    {
        InstallAllButton.IsEnabled = false;
        ShowLogs();
        foreach (var item in _prereqs.Where(p => p.State == PrereqState.Missing).ToList())
        {
            if (item.WingetId == null && item.Id != "model") continue;
            DispatcherQueue.TryEnqueue(() => _rows[item.Id].Refresh());
            await Prerequisites.InstallAsync(item, AppendLog);
            await Prerequisites.CheckAsync(item);
            DispatcherQueue.TryEnqueue(() => _rows[item.Id].Refresh());
        }
        UpdateContinueState();
    }

    private async void OnRecheck(object sender, RoutedEventArgs e)
    {
        foreach (var item in _prereqs)
        {
            item.State = PrereqState.Checking;
            _rows[item.Id].Refresh();
        }
        await CheckAllAsync();
    }

    private void OnToggleLogs(object sender, RoutedEventArgs e)
    {
        LogScroller.Visibility = LogScroller.Visibility == Visibility.Visible
            ? Visibility.Collapsed : Visibility.Visible;
        ShowLogsButton.Content = LogScroller.Visibility == Visibility.Visible
            ? "Hide install logs" : "Show install logs";
    }

    private void ShowLogs()
    {
        LogScroller.Visibility = Visibility.Visible;
        ShowLogsButton.Content = "Hide install logs";
    }

    private void AppendLog(string line)
    {
        DispatcherQueue.TryEnqueue(() =>
        {
            LogText.Text += line + Environment.NewLine;
        });
    }

    private static void OpenUrl(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
    }

    private async void OnContinue(object sender, RoutedEventArgs e)
    {
        PrereqOverlay.Visibility = Visibility.Collapsed;
        LoadingOverlay.Visibility = Visibility.Visible;
        await StartBackendAndLoadAsync();
    }

    // ---------------- Backend + WebView ----------------

    private async Task StartBackendAndLoadAsync()
    {
        try
        {
            UpdateStatus("Locating Python...");
            var pythonPath = FindPython();
            if (pythonPath == null)
            {
                UpdateStatus("Python not found. Please install Python 3.10+ and try again.");
                return;
            }

            // Skip pip install if the backend already imports cleanly — saves ~10s on every cold start.
            UpdateStatus("Checking dependencies...");
            if (!await BackendImportsOkAsync(pythonPath))
            {
                UpdateStatus("Installing dependencies (first run)...");
                await InstallDependenciesAsync(pythonPath);
            }

            UpdateStatus("Starting backend server...");
            StartPythonServer(pythonPath);

            UpdateStatus("Waiting for server...");
            var ready = await WaitForServerAsync();
            if (!ready)
            {
                var tail = GetBackendLogTail(800);
                UpdateStatus("Server failed to start.\n" + (string.IsNullOrWhiteSpace(tail) ? "No output captured." : tail));
                return;
            }

            UpdateStatus("Loading app...");
            await InitWebViewAsync();
        }
        catch (Exception ex)
        {
            UpdateStatus($"Error: {ex.Message}");
        }
    }

    private void UpdateStatus(string text)
    {
        DispatcherQueue.TryEnqueue(() => LoadingStatus.Text = text);
    }

    private static string? FindPython()
    {
        // First try PATH-resolvable launchers.
        foreach (var name in new[] { "py", "python", "python3" })
        {
            try
            {
                var psi = new ProcessStartInfo(name, name == "py" ? "-3 --version" : "--version")
                {
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using var proc = Process.Start(psi);
                proc?.WaitForExit(5000);
                if (proc?.ExitCode == 0) return name;
            }
            catch { }
        }

        // Fallback: scan common install locations. Useful immediately after a winget
        // install when this process's PATH hasn't been refreshed yet.
        string[] roots =
        {
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) + @"\Programs\Python",
            @"C:\Program Files\Python",
            @"C:\Python"
        };
        foreach (var root in roots)
        {
            if (!Directory.Exists(root)) continue;
            try
            {
                var hits = Directory.EnumerateFiles(root, "python.exe", SearchOption.AllDirectories);
                foreach (var path in hits)
                {
                    if (path.Contains("Scripts", StringComparison.OrdinalIgnoreCase)) continue;
                    return path;
                }
            }
            catch { }
        }
        return null;
    }

    private static async Task<bool> BackendImportsOkAsync(string pythonPath)
    {
        var backendDir = GetBackendDir();
        if (!File.Exists(Path.Combine(backendDir, "app.py"))) return false;
        var probe = $"import sys; sys.path.insert(0, r'{backendDir}'); import app";
        var args = pythonPath == "py" ? $"-3 -c \"{probe}\"" : $"-c \"{probe}\"";
        try
        {
            var psi = new ProcessStartInfo(pythonPath, args)
            {
                WorkingDirectory = backendDir,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
            psi.EnvironmentVariables["PYTHONUTF8"] = "1";
            using var p = Process.Start(psi);
            if (p == null) return false;
            using var cts = new System.Threading.CancellationTokenSource(TimeSpan.FromSeconds(15));
            try { await p.WaitForExitAsync(cts.Token); }
            catch (OperationCanceledException) { try { p.Kill(true); } catch { } return false; }
            return p.ExitCode == 0;
        }
        catch { return false; }
    }

    private async Task InstallDependenciesAsync(string pythonPath)
    {
        var backendDir = GetBackendDir();
        var reqFile = Path.Combine(backendDir, "requirements.txt");
        if (!File.Exists(reqFile)) return;

        var args = pythonPath == "py"
            ? $"-3 -m pip install --quiet --disable-pip-version-check -r \"{reqFile}\""
            : $"-m pip install --quiet --disable-pip-version-check -r \"{reqFile}\"";

        var psi = new ProcessStartInfo(pythonPath, args)
        {
            WorkingDirectory = backendDir,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
        psi.EnvironmentVariables["PYTHONUTF8"] = "1";

        using var proc = Process.Start(psi);
        if (proc != null)
            await proc.WaitForExitAsync();
    }

    private void StartPythonServer(string pythonPath)
    {
        var backendDir = GetBackendDir();
        var inlineScript = $"import uvicorn; import sys; sys.path.insert(0, r'{backendDir}'); from app import app; uvicorn.run(app, host='127.0.0.1', port={ServerPort})";
        var args = pythonPath == "py"
            ? $"-3 -u -c \"{inlineScript}\""
            : $"-u -c \"{inlineScript}\"";

        var psi = new ProcessStartInfo(pythonPath, args)
        {
            WorkingDirectory = backendDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        // Force UTF-8 on the Python child so prints like ✓ / emoji don't crash on cp1252 systems.
        psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
        psi.EnvironmentVariables["PYTHONUTF8"] = "1";

        _pythonProcess = Process.Start(psi);
        if (_pythonProcess != null)
        {
            // Drain stdout/stderr to a ring buffer so we can surface diagnostics on failure.
            // Without these the Python process would block once the OS pipe buffer fills (~4 KB).
            _pythonProcess.OutputDataReceived += (_, e) => AppendBackendLog(e.Data);
            _pythonProcess.ErrorDataReceived += (_, e) => AppendBackendLog(e.Data);
            _pythonProcess.BeginOutputReadLine();
            _pythonProcess.BeginErrorReadLine();
        }
    }

    private void AppendBackendLog(string? line)
    {
        if (string.IsNullOrEmpty(line)) return;
        lock (_backendLog)
        {
            _backendLog.AppendLine(line);
            // Cap at ~16 KB to avoid unbounded growth.
            if (_backendLog.Length > 16384)
                _backendLog.Remove(0, _backendLog.Length - 16384);
        }
    }

    private string GetBackendLogTail(int maxChars)
    {
        lock (_backendLog)
        {
            var s = _backendLog.ToString();
            return s.Length <= maxChars ? s : s.Substring(s.Length - maxChars);
        }
    }

    private static string GetBackendDir()
    {
        var exeDir = AppContext.BaseDirectory;
        var backendDir = Path.Combine(exeDir, "Assets", "Backend");
        if (Directory.Exists(backendDir)) return backendDir;

        var repoRoot = Path.GetFullPath(Path.Combine(exeDir, "..", "..", "..", ".."));
        if (File.Exists(Path.Combine(repoRoot, "app.py"))) return repoRoot;

        return backendDir;
    }

    private async Task<bool> WaitForServerAsync()
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        // Allow up to 60s for first start (Foundry init can be slow on first run).
        for (int i = 0; i < 60; i++)
        {
            // Bail out fast if the Python process has already crashed.
            if (_pythonProcess != null && _pythonProcess.HasExited)
            {
                AppendBackendLog($"[backend exited with code {_pythonProcess.ExitCode}]");
                return false;
            }
            try
            {
                var resp = await client.GetAsync(ServerUrl);
                if (resp.IsSuccessStatusCode) return true;
            }
            catch { }
            await Task.Delay(1000);
        }
        return false;
    }

    private Microsoft.UI.Xaml.Controls.WebView2? AppWebView;

    private async Task InitWebViewAsync()
    {
        if (AppWebView is null)
        {
            AppWebView = new Microsoft.UI.Xaml.Controls.WebView2
            {
                DefaultBackgroundColor = Windows.UI.Color.FromArgb(0xFF, 0x0a, 0x0a, 0x0f)
            };
            WebViewHost.Children.Add(AppWebView);
            WebViewHost.Visibility = Visibility.Visible;
        }

        await AppWebView.EnsureCoreWebView2Async();
        AppWebView.CoreWebView2.Settings.IsStatusBarEnabled = false;
        AppWebView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;

        AppWebView.Source = new Uri(ServerUrl);

        AppWebView.NavigationCompleted += (s, e) =>
        {
            DispatcherQueue.TryEnqueue(() =>
            {
                LoadingOverlay.Visibility = Visibility.Collapsed;
                if (AppWebView is not null) AppWebView.Visibility = Visibility.Visible;
            });
        };
    }

    private void OnWindowClosed(object sender, WindowEventArgs e)
    {
        try
        {
            if (_pythonProcess != null && !_pythonProcess.HasExited)
            {
                _pythonProcess.Kill(entireProcessTree: true);
                _pythonProcess.Dispose();
            }
        }
        catch { }
    }
}
