$backendLog = "C:\Users\Gilles\Documents\MOI\Powerlens\PowerLens\backend.log"
$metroLog = "C:\Users\Gilles\Documents\MOI\Powerlens\PowerLens\metro.log"
$watchLog = "C:\Users\Gilles\Documents\MOI\Powerlens\PowerLens\watch.log"

$backendPos = (Get-Item $backendLog -ErrorAction SilentlyContinue).Length ?? 0
$metroPos = (Get-Item $metroLog -ErrorAction SilentlyContinue).Length ?? 0

while ($true) {
    # Backend
    if (Test-Path $backendLog) {
        $fs = [System.IO.File]::Open($backendLog, 'Open', 'Read', 'ReadWrite')
        $fs.Seek($backendPos, 'Begin') | Out-Null
        $reader = New-Object System.IO.StreamReader($fs)
        $newContent = $reader.ReadToEnd()
        $backendPos = $fs.Position
        $reader.Close(); $fs.Close()
        if ($newContent.Trim()) {
            $lines = $newContent -split "`n" | Where-Object { $_.Trim() }
            foreach ($line in $lines) {
                "[BACKEND] $line" | Out-File $watchLog -Append -Encoding UTF8
            }
        }
    }
    # Metro
    if (Test-Path $metroLog) {
        $fs = [System.IO.File]::Open($metroLog, 'Open', 'Read', 'ReadWrite')
        $fs.Seek($metroPos, 'Begin') | Out-Null
        $reader = New-Object System.IO.StreamReader($fs)
        $newContent = $reader.ReadToEnd()
        $metroPos = $fs.Position
        $reader.Close(); $fs.Close()
        if ($newContent.Trim()) {
            $lines = $newContent -split "`n" | Where-Object { $_.Trim() }
            foreach ($line in $lines) {
                "[METRO] $line" | Out-File $watchLog -Append -Encoding UTF8
            }
        }
    }
    Start-Sleep -Seconds 3
}
