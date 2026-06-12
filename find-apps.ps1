Write-Host "--- Scanning all shell open commands in HKCU ---"
Get-ChildItem -Path "HKCU:\Software\Classes" -ErrorAction SilentlyContinue | Where-Object { Test-Path "$($_.PSPath)\shell\open\command" } | ForEach-Object {
    $key = "$($_.PSPath)\shell\open\command"
    $val = Get-ItemPropertyValue -Path $key -Name "(default)" -ErrorAction SilentlyContinue
    if (!$val) {
        $val = (Get-Item $key).GetValue("")
    }
    Write-Host "$($_.PSChildName) : $val"
}

Write-Host "--- Scanning all shell open commands in HKLM ---"
Get-ChildItem -Path "HKLM:\Software\Classes" -ErrorAction SilentlyContinue | Where-Object { Test-Path "$($_.PSPath)\shell\open\command" } | ForEach-Object {
    $key = "$($_.PSPath)\shell\open\command"
    $val = Get-ItemPropertyValue -Path $key -Name "(default)" -ErrorAction SilentlyContinue
    if (!$val) {
        $val = (Get-Item $key).GetValue("")
    }
    Write-Host "$($_.PSChildName) : $val"
}
