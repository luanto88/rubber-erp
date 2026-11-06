Add-Type -AssemblyName System.IO.Compression.FileSystem
$docx = (Get-ChildItem 'cung_cap_dl\2718\*.docx')[0].FullName
$zip = [System.IO.Compression.ZipFile]::OpenRead($docx)
$entry = $zip.GetEntry('word/document.xml')
$stream = $entry.Open()
$reader = New-Object System.IO.StreamReader($stream)
$xml = [xml]$reader.ReadToEnd()
$reader.Close()
$stream.Close()
$zip.Dispose()

$ns = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
$ns.AddNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')
$paragraphs = $xml.SelectNodes('//w:p', $ns)
$lines = @()
foreach ($p in $paragraphs) {
    $tNodes = $p.SelectNodes('.//w:t', $ns)
    $line = ''
    foreach ($t in $tNodes) { $line += $t.InnerText }
    if ($line.Trim()) { $lines += $line }
}
$lines | Out-File -FilePath 'cung_cap_dl\2718\extracted_docx.txt' -Encoding utf8
Write-Host ("Extracted " + $lines.Count + " lines.")

