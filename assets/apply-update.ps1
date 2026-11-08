param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [Parameter(Mandatory = $true)][int]$ApplicationPid,
    [Parameter(Mandatory = $true)][string]$InstallDirectory
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    if (!(Test-Path -LiteralPath $Installer -PathType Leaf)) { throw '更新安装包已丢失，请重新下载。' }
    if (Get-Process -Id $ApplicationPid -ErrorAction SilentlyContinue) {
        Wait-Process -Id $ApplicationPid -Timeout 30 -ErrorAction Stop
    }
    # NSIS consumes the remaining command line after /D= as the installation path.
    $arguments = @('/S', '--updated', '--force-run', "/D=$InstallDirectory")
    $process = Start-Process -FilePath $Installer -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "更新安装程序返回错误 $($process.ExitCode)。" }
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Nexo 更新失败') | Out-Null
    exit 1
}
