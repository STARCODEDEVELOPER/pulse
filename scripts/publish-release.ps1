$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$secretPath = Join-Path $root '.release-secret.tmp'
$projectUrl = 'https://cmvlzrkeumwysigcfklk.supabase.co'
$key = Get-Content -Raw $secretPath
try {
  $installer = Get-ChildItem (Join-Path $root 'dist') -Filter 'Pulse-Setup-*.exe' | Sort-Object Name | Select-Object -Last 1
  if(-not $installer) { throw 'Installer not found in dist.' }
  $version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
  $bytes = [System.IO.File]::ReadAllBytes($installer.FullName)
  $sha = [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
  $shaHex = ([System.BitConverter]::ToString($sha)).Replace('-', '').ToLowerInvariant()
  $encodedName = [uri]::EscapeDataString($installer.Name)
  $publicUrl = "$projectUrl/storage/v1/object/public/releases/$encodedName"
  $headers = @{ Authorization = "Bearer $key"; apikey = $key; 'x-upsert' = 'true' }
  $uploadUrl = "$projectUrl/storage/v1/object/releases/$encodedName"
  Invoke-WebRequest -Uri $uploadUrl -Method Post -Headers $headers -InFile $installer.FullName -ContentType 'application/octet-stream' -TimeoutSec 600 | Out-Null
  $manifest = @{ product='Pulse'; version=$version; releasedAt=(Get-Date).ToUniversalTime().ToString('o'); notes="Pulse $version"; windows=@{ url=$publicUrl; sha256=$shaHex; size=$installer.Length; filename=$installer.Name } } | ConvertTo-Json -Depth 5
  $manifestPath = Join-Path $root 'latest.json'
  [System.IO.File]::WriteAllText($manifestPath, $manifest, [System.Text.UTF8Encoding]::new($false))
  Invoke-WebRequest -Uri "$projectUrl/storage/v1/object/releases/latest.json" -Method Post -Headers $headers -InFile $manifestPath -ContentType 'application/json' -TimeoutSec 60 | Out-Null
  Write-Output "PUBLISHED Pulse $version $publicUrl SHA256=$shaHex"
  Remove-Item -Force $manifestPath
} finally {
  Remove-Item -Force $secretPath -ErrorAction SilentlyContinue
}
