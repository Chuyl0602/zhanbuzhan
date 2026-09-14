$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$assetDir = Join-Path $projectRoot 'assets'
$source = [System.Drawing.Image]::FromFile((Join-Path $assetDir 'brand-logo.png'))
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$frames = [System.Collections.Generic.List[object]]::new()

try {
  foreach ($size in $sizes) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.Clear([System.Drawing.Color]::Transparent)

      $margin = [Math]::Max(1, $size * 0.025)
      $radius = $size * 0.15
      $edge = $size - 2 * $margin
      $background = [System.Drawing.Drawing2D.GraphicsPath]::new()
      try {
        $background.AddArc($margin, $margin, 2 * $radius, 2 * $radius, 180, 90)
        $background.AddArc($margin + $edge - 2 * $radius, $margin, 2 * $radius, 2 * $radius, 270, 90)
        $background.AddArc($margin + $edge - 2 * $radius, $margin + $edge - 2 * $radius, 2 * $radius, 2 * $radius, 0, 90)
        $background.AddArc($margin, $margin + $edge - 2 * $radius, 2 * $radius, 2 * $radius, 90, 90)
        $background.CloseFigure()
        $graphics.FillPath([System.Drawing.Brushes]::White, $background)
        $border = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(215, 222, 229), [Math]::Max(0.6, $size / 256))
        try { $graphics.DrawPath($border, $background) } finally { $border.Dispose() }
      } finally { $background.Dispose() }

      $logoWidth = $size * 0.88
      $logoHeight = $logoWidth * $source.Height / $source.Width
      $logo = [System.Drawing.RectangleF]::new([single](($size - $logoWidth) / 2), [single](($size - $logoHeight) / 2), [single]$logoWidth, [single]$logoHeight)
      $graphics.DrawImage($source, $logo)

      $png = [System.IO.MemoryStream]::new()
      try {
        $bitmap.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
        $frames.Add([pscustomobject]@{ Size = $size; Bytes = $png.ToArray() })
      } finally { $png.Dispose() }
      if ($size -eq 32) { $bitmap.Save((Join-Path $assetDir 'tray.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
      if ($size -eq 256) { $bitmap.Save((Join-Path $assetDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
  }
} finally { $source.Dispose() }

$stream = [System.IO.File]::Create((Join-Path $assetDir 'icon.ico'))
$writer = [System.IO.BinaryWriter]::new($stream)
try {
  $writer.Write([uint16]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]$frames.Count)
  $offset = 6 + 16 * $frames.Count
  foreach ($frame in $frames) {
    $dimension = if ($frame.Size -eq 256) { [byte]0 } else { [byte]$frame.Size }
    $writer.Write($dimension)
    $writer.Write($dimension)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]$frame.Bytes.Length)
    $writer.Write([uint32]$offset)
    $offset += $frame.Bytes.Length
  }
  foreach ($frame in $frames) { $writer.Write($frame.Bytes) }
} finally { $writer.Dispose(); $stream.Dispose() }
