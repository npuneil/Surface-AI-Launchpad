#nullable enable
using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;

namespace NPUniversity.Desktop;

public sealed partial class MainWindow : Window
{
    private Process? _pythonProcess;
    private const int ServerPort = 8099;
    private const string ServerUrl = "http://127.0.0.1:8099";

    public MainWindow()
    {
        this.InitializeComponent();
        this.Title = "NPUniversity — Your On-Device AI Campus";
        this.AppWindow.Resize(new Windows.Graphics.SizeInt32(1400, 900));

        this.Closed += OnWindowClosed;
        _ = StartBackendAndLoadAsync();
    }

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
        // Try common Python executable names
        foreach (var name in new[] { "python", "python3", "py" })
        {
            try
            {
                var psi = new ProcessStartInfo(name, "--version")
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

        var psi = new ProcessStartInfo(pythonPath, $"-m pip install --quiet --disable-pip-version-check -r \"{reqFile}\"")
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
        var appPy = Path.Combine(backendDir, "app.py");

        var psi = new ProcessStartInfo(pythonPath, $"-u -c \"import uvicorn; import sys; sys.path.insert(0, r'{backendDir}'); from app import app; uvicorn.run(app, host='127.0.0.1', port={ServerPort})\"")
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
        // When running from MSIX or output directory, backend files are in Assets\Backend
        var exeDir = AppContext.BaseDirectory;
        var backendDir = Path.Combine(exeDir, "Assets", "Backend");
        if (Directory.Exists(backendDir)) return backendDir;

        // Fallback: development mode — files are in the repo root (two levels up from Desktop project)
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
