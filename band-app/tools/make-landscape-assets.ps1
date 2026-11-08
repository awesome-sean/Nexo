Add-Type -AssemblyName System.Drawing
$dinFonts = [System.Drawing.Text.PrivateFontCollection]::new()
$dinFonts.AddFontFile('C:/Windows/Fonts/DINNextLTPro-Bold.ttf')
$palette = @{
    Primary = '#F4F5F8'
    Secondary = '#B3BBC9'
    Muted = '#8C95A5'
    Value = '#DFE3EA'
    Money = '#FFFFFF'
    Five = '#DDF58D'
    FiveTrack = '#252D19'
    Week = '#BE9AF0'
    WeekTrack = '#2C233B'
}
$assetDir = Join-Path $PSScriptRoot '../src/common/landscape124'
New-Item -ItemType Directory -Force -Path $assetDir | Out-Null

function Save-Rotated($bitmap, $name, $width, $height) {
    $small = New-Object System.Drawing.Bitmap($width, $height)
    $g = [System.Drawing.Graphics]::FromImage($small)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($bitmap, 0, 0, $width, $height)
    $g.Dispose()
    $small.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone)
    $small.Save((Join-Path $assetDir "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $small.Dispose()
    $bitmap.Dispose()
}

function Draw-Text($graphics, $text, $x, $y, $width, $height, $size, $color, $alignment = 'Center', $baseline = -1, $strokeWidth = 0) {
    $family = if ($text -match '[\u4e00-\u9fff]') { [System.Drawing.FontFamily]::new('Microsoft YaHei UI') } else { $dinFonts.Families[0] }
    $font = New-Object System.Drawing.Font($family, $size, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($color))
    $format = [System.Drawing.StringFormat]::GenericTypographic.Clone()
    $format.FormatFlags = $format.FormatFlags -bor [System.Drawing.StringFormatFlags]::NoWrap
    $reference = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $referenceText = if ($text -match '[\u4e00-\u9fff]') { '国' } else { '0' }
    $reference.AddString($referenceText, $font.FontFamily, [int][System.Drawing.FontStyle]::Bold, [single]$size, [System.Drawing.PointF]::new(0, 0), $format)
    $referenceBounds = $reference.GetBounds()
    $glyph = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $glyph.AddString($text, $font.FontFamily, [int][System.Drawing.FontStyle]::Bold, [single]$size, [System.Drawing.PointF]::new(0, 0), $format)
    if ($glyph.PointCount -gt 0) {
        $bounds = $glyph.GetBounds()
        $offsetX = $x + ($width - $bounds.Width) / 2 - $bounds.Left
        if ($alignment -eq 'Far') { $offsetX = $x + $width - 1 - $bounds.Right }
        if ($alignment -eq 'Near') { $offsetX = $x + 1 - $bounds.Left }
        $offsetY = $y + ($height - $referenceBounds.Height) / 2 - $referenceBounds.Top
        if ($baseline -ge 0) { $offsetY = $y + $baseline - $referenceBounds.Bottom }
        $transform = [System.Drawing.Drawing2D.Matrix]::new()
        $transform.Translate([single]$offsetX, [single]$offsetY)
        $glyph.Transform($transform)
        $graphics.FillPath($brush, $glyph)
        if ($strokeWidth -gt 0) {
            $outline = [System.Drawing.Pen]::new($brush.Color, [single]$strokeWidth)
            $outline.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
            $graphics.DrawPath($outline, $glyph)
            $outline.Dispose()
        }
        $transform.Dispose()
    }
    $glyph.Dispose(); $reference.Dispose()
    $font.Dispose(); $brush.Dispose(); $format.Dispose()
}

function Save-Label($name, $text, $width, $height, $size, $color, $alignment = 'Center', $baseline = -1, $strokeWidth = 0) {
    $bitmap = New-Object System.Drawing.Bitmap(($width * 3), ($height * 3))
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.Clear([System.Drawing.Color]::Black)
    $graphics.ScaleTransform(3, 3)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    Draw-Text $graphics $text 0 0 $width $height $size $color $alignment $baseline $strokeWidth
    $graphics.Dispose()
    Save-Rotated $bitmap $name $width $height
}

function Save-Ring($kind, $percent, $color, $track, $label) {
    $bitmap = New-Object System.Drawing.Bitmap(348,348)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.Clear([System.Drawing.Color]::Black)
    $graphics.ScaleTransform(3,3)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $basePen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml($track), 16)
    $fillPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml($color), 16)
    $fillPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $fillPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $graphics.DrawEllipse($basePen,8,8,100,100)
    if ($percent -eq 100) { $graphics.DrawEllipse($fillPen,8,8,100,100) }
    elseif ($percent -gt 0) { $graphics.DrawArc($fillPen,8,8,100,100,-90,([single](3.6 * $percent))) }
    $value = "$percent"
    if ($percent -lt 0) { $value = '--' }
    Draw-Text $graphics $value 12 23 92 49 46 $palette.Primary
    Draw-Text $graphics $label 18 71 80 19 12 $color
    $graphics.Dispose(); $basePen.Dispose(); $fillPen.Dispose()
    $suffix = "$percent"
    if ($percent -lt 0) { $suffix = 'unknown' }
    Save-Rotated $bitmap "ring-$kind-$suffix" 116 116
}

foreach ($digit in 0..9) {
    Save-Label "clock-$digit" "$digit" 41 90 78 $palette.Primary
    Save-Label "date-$digit" "$digit" 26 54 46 $palette.Secondary
}
Save-Label 'clock-colon' ':' 16 90 72 $palette.Primary
Save-Label 'date-slash' '/' 14 54 46 $palette.Secondary
Save-Label 'reset-label' '重置' 28 28 14 $palette.Muted 'Center' 22
Save-Label 'money-label' '花费' 32 30 15 $palette.Money 'Near' 24
Save-Label 'money-partial' '花费' 32 30 15 $palette.Money 'Near' 24
Save-Label 'money-symbol' '≈¥' 24 30 22 $palette.Money 'Center' 24
Save-Label 'money-symbol-partial' '≈¥' 24 30 22 $palette.Money 'Center' 24
foreach ($character in '0123456789:/-'.ToCharArray()) {
    $name = "$character"
    if ($character -eq ':') { $name = 'colon' }
    if ($character -eq '/') { $name = 'slash' }
    if ($character -eq '-') { $name = 'dash' }
    Save-Label "small-$name" "$character" 11 28 20 $palette.Value 'Center' 22 0.4
}
foreach ($character in '0123456789.-wm '.ToCharArray()) {
    $name = "$character"
    if ($character -eq '.') { $name = 'dot' }
    if ($character -eq '-') { $name = 'dash' }
    if ($character -eq ' ') { $name = 'blank' }
    $width = if ($character -eq '.') { 4 } else { 12 }
    Save-Label "money-$name" "$character" $width 30 22 $palette.Money 'Center' 24
}
foreach ($percent in -1..100) {
    Save-Ring 'five' $percent $palette.Five $palette.FiveTrack '5H 剩余'
    Save-Ring 'week' $percent $palette.Week $palette.WeekTrack '7D 剩余'
}
Write-Output 'Generated ring layout assets'

