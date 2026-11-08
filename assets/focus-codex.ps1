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

function Get-CodexProcesses {
    @(Get-Process -Name 'ChatGPT', 'Codex' -ErrorAction SilentlyContinue | Where-Object {
        try {
            $_.Path -match '[\\/]OpenAI\.Codex_[^\\/]+[\\/]' -or
            $_.Path -match '[\\/]Programs[\\/]Codex[\\/]Codex\.exe$'
        } catch { $false }
    })
}

try {
    $processes = @(Get-CodexProcesses)
    $window = [NexoCodexWindow]::Find([System.UInt32[]]@($processes | ForEach-Object { $_.Id }))
    if ($window -eq [IntPtr]::Zero) {
        $startApp = Get-StartApps -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'Codex' } | Select-Object -First 1
        if ($startApp -and $startApp.AppID -match '^[A-Za-z0-9._-]+![A-Za-z0-9._-]+$') {
            Start-Process -FilePath 'explorer.exe' -ArgumentList "shell:AppsFolder\$($startApp.AppID)" -WindowStyle Hidden
        } elseif ($processes.Count -gt 0) {
            Start-Process -FilePath $processes[0].Path -WindowStyle Normal
        } else {
            throw '未找到 Codex 桌面应用，请先安装或打开 Codex。'
        }
    }

    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($window -ne [IntPtr]::Zero -and [NexoCodexWindow]::Activate($window)) {
            @{ ok = $true } | ConvertTo-Json -Compress
            exit 0
        }
        Start-Sleep -Milliseconds 200
        $processes = @(Get-CodexProcesses)
        $window = [NexoCodexWindow]::Find([System.UInt32[]]@($processes | ForEach-Object { $_.Id }))
    }
    throw 'Codex 已打开，但 Windows 未能将窗口切到前台，请点击任务栏中的 Codex。'
} catch {
    @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    exit 1
}
