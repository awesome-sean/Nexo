$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class NexoCodexWindow {
    private delegate bool WindowCallback(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr window);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);

    public static IntPtr Find(uint[] processIds) {
        var candidates = new HashSet<uint>(processIds);
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr parameter) {
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            if (candidates.Contains(processId) && IsWindowVisible(window) && GetWindowTextLength(window) > 0) {
                found = window;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static bool Activate(IntPtr window) {
        ShowWindowAsync(window, IsIconic(window) ? 9 : 5);
        SetWindowPos(window, IntPtr.Zero, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040);
        SetForegroundWindow(window);
        System.Threading.Thread.Sleep(100);
        return GetForegroundWindow() == window;
    }
}
'@

function Get-ChatGPTProcesses {
    @(Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue)
}

try {
    $processes = @(Get-ChatGPTProcesses)
    $window = [NexoCodexWindow]::Find([System.UInt32[]]@($processes | ForEach-Object { $_.Id }))
    if ($window -eq [IntPtr]::Zero) {
        $startApp = Get-StartApps -ErrorAction SilentlyContinue | Where-Object { $_.Name -in @('ChatGPT', 'Codex') } | Sort-Object @{ Expression = { if ($_.Name -eq 'ChatGPT') { 0 } else { 1 } } } | Select-Object -First 1
        if ($startApp -and $startApp.AppID -match '^[A-Za-z0-9._-]+![A-Za-z0-9._-]+$') {
            Start-Process -FilePath 'explorer.exe' -ArgumentList "shell:AppsFolder\$($startApp.AppID)" -WindowStyle Hidden
        } elseif ($startApp -and [IO.Path]::IsPathRooted($startApp.AppID) -and $startApp.AppID.EndsWith('.exe') -and (Test-Path -LiteralPath $startApp.AppID)) {
            Start-Process -FilePath $startApp.AppID -WindowStyle Hidden
        } elseif ($processes.Count -gt 0) {
            Start-Process -FilePath $processes[0].Path -WindowStyle Hidden
        } else {
            throw '未找到 ChatGPT 桌面应用，请先安装或打开 ChatGPT。'
        }
    }

    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($window -ne [IntPtr]::Zero -and [NexoCodexWindow]::Activate($window)) {
            @{ ok = $true } | ConvertTo-Json -Compress
            exit 0
        }
        Start-Sleep -Milliseconds 200
        $processes = @(Get-ChatGPTProcesses)
        $window = [NexoCodexWindow]::Find([System.UInt32[]]@($processes | ForEach-Object { $_.Id }))
    }
    throw 'ChatGPT 已打开，但 Windows 未能将窗口切到前台，请点击任务栏中的 ChatGPT。'
} catch {
    @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    exit 1
}
