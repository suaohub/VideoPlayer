Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$iconSizes = @(256, 128, 64, 48, 32, 16)

function New-RoundRectPath([float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $radius * 2
  $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
  $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
  $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Draw-RoundRect($graphics, [string]$color, [float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
  $path = New-RoundRectPath $x $y $width $height $radius
  $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($color))
  $graphics.FillPath($brush, $path)
  $brush.Dispose()
  $path.Dispose()
}

function New-IconPng([int]$size) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.ScaleTransform($size / 256.0, $size / 256.0)
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $rear = New-RoundRectPath 47 40 142 164 27
  $rearFill = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#253047'))
  $rearPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(158, 124, 140, 255), 9)
  $graphics.FillPath($rearFill, $rear)
  $graphics.DrawPath($rearPen, $rear)

  $middle = New-RoundRectPath 66 55 142 164 27
  $middleFill = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#303b54'))
  $middlePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(61, 255, 255, 255), 3)
  $graphics.FillPath($middleFill, $middle)
  $graphics.DrawPath($middlePen, $middle)
  Draw-RoundRect $graphics '#5878f4' 83 70 142 164 27
  Draw-RoundRect $graphics '#f5f6ff' 105 101 41 41 10

  $triangle = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(121, 111),
    [System.Drawing.PointF]::new(121, 132),
    [System.Drawing.PointF]::new(137, 121.5)
  )
  $white = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#f5f6ff'))
  $blue = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#5878f4'))
  $graphics.FillPolygon($blue, $triangle)
  Draw-RoundRect $graphics '#f5f6ff' 157 105 46 7 3.5
  Draw-RoundRect $graphics '#aebeff' 157 119 34 6 3
  Draw-RoundRect $graphics '#f5f6ff' 105 159 98 7 3.5
  Draw-RoundRect $graphics '#aebeff' 105 175 73 6 3

  $stream = [System.IO.MemoryStream]::new()
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $stream.ToArray()
  $stream.Dispose()
  $blue.Dispose(); $white.Dispose(); $middlePen.Dispose(); $middleFill.Dispose()
  $rearPen.Dispose(); $rearFill.Dispose(); $middle.Dispose(); $rear.Dispose()
  $graphics.Dispose(); $bitmap.Dispose()
  return ,$bytes
}

$root = Split-Path -Parent $PSScriptRoot
$pngBytes = New-IconPng 256
[System.IO.File]::WriteAllBytes((Join-Path $root 'assets\icon.png'), $pngBytes)

$entries = @($iconSizes | ForEach-Object { [pscustomobject]@{ Size = $_; Bytes = (New-IconPng $_) } })
$headerSize = 6 + 16 * $entries.Count
$offset = $headerSize
$icoStream = [System.IO.MemoryStream]::new()
$writer = [System.IO.BinaryWriter]::new($icoStream)
$writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]$entries.Count)
foreach ($entry in $entries) {
  $dimension = if ($entry.Size -eq 256) { [byte]0 } else { [byte]$entry.Size }
  $writer.Write($dimension); $writer.Write($dimension); $writer.Write([byte]0); $writer.Write([byte]0)
  $writer.Write([UInt16]1); $writer.Write([UInt16]32)
  $writer.Write([UInt32]$entry.Bytes.Length); $writer.Write([UInt32]$offset)
  $offset += $entry.Bytes.Length
}
foreach ($entry in $entries) { $writer.Write($entry.Bytes) }
$writer.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $root 'assets\icon.ico'), $icoStream.ToArray())
$writer.Dispose(); $icoStream.Dispose()
Write-Output "Updated assets/icon.png and assets/icon.ico"
