# Extracts the HTML body from each .http file into a preview/ folder,
# then opens them all in your default browser.

$previewDir = Join-Path $PSScriptRoot "preview"
New-Item -ItemType Directory -Force -Path $previewDir | Out-Null

Get-ChildItem -Path $PSScriptRoot -Filter "*.http" | ForEach-Object {
    $raw = [System.IO.File]::ReadAllText($_.FullName)

    # Everything after the first blank line (\r\n\r\n) is the HTML body
    $split = $raw.IndexOf("`r`n`r`n")
    if ($split -eq -1) { $split = $raw.IndexOf("`n`n") }
    $html = $raw.Substring($split).TrimStart()

    $outPath = Join-Path $previewDir ($_.BaseName + ".html")
    [System.IO.File]::WriteAllText($outPath, $html, [System.Text.Encoding]::UTF8)
    Write-Host "Wrote $outPath"
}

Write-Host "`nOpening previews in browser..."
Get-ChildItem -Path $previewDir -Filter "*.html" | Sort-Object Name | ForEach-Object {
    Start-Process $_.FullName
    Start-Sleep -Milliseconds 300
}
