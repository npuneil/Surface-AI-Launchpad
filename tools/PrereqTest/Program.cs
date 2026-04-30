// Quick smoke-test harness for Prerequisites detection. Not part of the package.
// Run with: dotnet run --project tools/PrereqTest -c Release
using NPUniversity.Desktop.Services;

Console.WriteLine($"NPU vendor: {Prerequisites.DetectNpuVendor()}");
Console.WriteLine();

var items = Prerequisites.BuildList();
foreach (var item in items)
{
    await Prerequisites.CheckAsync(item);
    Console.WriteLine($"[{item.State,-12}] {item.Name,-40}  {item.Detail}");
}
