param(
  [Parameter(Mandatory = $true)]
  [string]$Version
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$archive = Join-Path $root "pixel-farm-theme-v$Version.zip"
Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
$stage = Join-Path $env:TEMP ("komari-pixel-farm-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $stage 'dist/assets') -Force | Out-Null
try {
  Copy-Item -LiteralPath (Join-Path $root 'komari-theme.json') -Destination $stage
  Copy-Item -LiteralPath (Join-Path $root 'preview.svg') -Destination $stage
  Copy-Item -LiteralPath (Join-Path $root 'dist/index.html') -Destination (Join-Path $stage 'dist')
  @('farm.css', 'farm.js', 'farm-map-v8.png', 'farm-map-spring.png', 'farm-map-autumn.png', 'farm-map-winter.png') | ForEach-Object {
    Copy-Item -LiteralPath (Join-Path $root "dist/assets/$_") -Destination (Join-Path $stage 'dist/assets')
  }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $archive -CompressionLevel Optimal
} finally {
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
