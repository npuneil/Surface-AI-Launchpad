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
        PrereqBanner.Title = vendor switch
        {
            NpuVendor.Qualcomm => "Snapdragon NPU detected",
            NpuVendor.Intel => "Intel Core Ultra NPU detected",
            NpuVendor.AMD => "AMD Ryzen AI NPU detected",
            _ => "No NPU detected"
        };
        PrereqBanner.Message = vendor == NpuVendor.None
            ? "NPUniversity will run on CPU. For best performance use a Copilot+ PC."
            : $"Foundry Local will accelerate models on the {vendor} NPU.";
        PrereqBanner.Severity = vendor == NpuVendor.None
            ? InfoBarSeverity.Warning
            : InfoBarSeverity.Success;

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

            UpdateStatus("Installing dependencies...");
            await InstallDependenciesAsync(pythonPath);

            UpdateStatus("Starting backend server...");
            StartPythonServer(pythonPath);

            UpdateStatus("Waiting for server...");
            var ready = await WaitForServerAsync();
            if (!ready)
            {
                UpdateStatus("Server failed to start. Check Python and dependencies.");
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
        return null;
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

        _pythonProcess = Process.Start(psi);
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

    private static async Task<bool> WaitForServerAsync()
    {
        using var client = new HttpClient();
        for (int i = 0; i < 30; i++)
        {
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

    private async Task InitWebViewAsync()
    {
        await AppWebView.EnsureCoreWebView2Async();
        AppWebView.CoreWebView2.Settings.IsStatusBarEnabled = false;
        AppWebView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;

        AppWebView.Source = new Uri(ServerUrl);

        AppWebView.NavigationCompleted += (s, e) =>
        {
            DispatcherQueue.TryEnqueue(() =>
            {
                LoadingOverlay.Visibility = Visibility.Collapsed;
                AppWebView.Visibility = Visibility.Visible;
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
