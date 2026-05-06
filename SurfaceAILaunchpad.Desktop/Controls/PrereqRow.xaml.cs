#nullable enable
using System;
using System.Threading.Tasks;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.UI;
using SurfaceAILaunchpad.Desktop.Services;

namespace SurfaceAILaunchpad.Desktop.Controls;

public sealed partial class PrereqRow : UserControl
{
    public event EventHandler<PrereqItem>? ActionRequested;
    private PrereqItem? _item;

    public PrereqRow()
    {
        this.InitializeComponent();
    }

    public void Bind(PrereqItem item)
    {
        _item = item;
        NameText.Text = item.Name;
        DescText.Text = item.Description;
        Refresh();
    }

    public void Refresh()
    {
        if (_item == null) return;
        DetailText.Text = _item.Detail ?? "";

        switch (_item.State)
        {
            case PrereqState.Installed:
                StatusIcon.Glyph = "\uE73E"; // checkmark
                StatusIcon.Foreground = new SolidColorBrush(Color.FromArgb(255, 0x55, 0xCC, 0x88));
                BusyRing.IsActive = false;
                ActionButton.Content = "Re-check";
                ActionButton.IsEnabled = true;
                break;
            case PrereqState.Missing:
                StatusIcon.Glyph = "\uE783"; // warning
                StatusIcon.Foreground = new SolidColorBrush(Color.FromArgb(255, 0xFF, 0xB0, 0x4D));
                BusyRing.IsActive = false;
                ActionButton.Content = _item.Id == "model" ? "Download" :
                                       _item.WingetId != null ? "Install" : "Open docs";
                ActionButton.IsEnabled = true;
                break;
            case PrereqState.Installing:
            case PrereqState.Checking:
                BusyRing.IsActive = true;
                ActionButton.IsEnabled = false;
                ActionButton.Content = _item.State == PrereqState.Installing ? "Installing…" : "Checking…";
                break;
            case PrereqState.Failed:
                StatusIcon.Glyph = "\uEA39"; // error
                StatusIcon.Foreground = new SolidColorBrush(Color.FromArgb(255, 0xFF, 0x6B, 0x6B));
                BusyRing.IsActive = false;
                ActionButton.Content = "Retry";
                ActionButton.IsEnabled = true;
                break;
            case PrereqState.NotApplicable:
                StatusIcon.Glyph = "\uE946"; // info
                StatusIcon.Foreground = new SolidColorBrush(Color.FromArgb(255, 0x88, 0x99, 0xBB));
                BusyRing.IsActive = false;
                ActionButton.Content = "Learn more";
                ActionButton.IsEnabled = _item.DocsUrl != null;
                break;
            default:
                StatusIcon.Glyph = "\uE9CE";
                StatusIcon.Foreground = new SolidColorBrush(Color.FromArgb(255, 0x88, 0x88, 0xAA));
                ActionButton.Content = "Check";
                ActionButton.IsEnabled = true;
                break;
        }
    }

    private void OnAction(object sender, Microsoft.UI.Xaml.RoutedEventArgs e)
    {
        if (_item != null) ActionRequested?.Invoke(this, _item);
    }
}
