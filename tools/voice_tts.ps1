param([string]$OutDir)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$voices = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices
$voices | ForEach-Object { Write-Output ("voice: " + $_.DisplayName + " " + $_.Language) }
$v = $voices | Where-Object { $_.DisplayName -like '*Zhiwei*' } | Select-Object -First 1
if (-not $v) { $v = $voices | Where-Object { $_.Language -eq 'zh-TW' } | Select-Object -First 1 }
$synth.Voice = $v
$lines = [ordered]@{
  c2 = '薯餅衝刺！'; c3 = '皮蛋出動！'; c4 = '蛋黃哥醒了！'; c5 = '三寶合體！'; combo = '蛋黃哥不躺了！';
  sugar = '薯餅狂歡時間！'; s1 = '薯餅頂橘子！'; s2 = '小豬搭便車！'; win3 = '三寶都愛你！'; start = '薯餅準備好了！'
}
foreach ($k in $lines.Keys) {
  $text = $lines[$k]
  $ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-TW'><prosody rate='0.92' pitch='+0%' volume='x-loud'>$text</prosody></speak>"
  $stream = Await ($synth.SynthesizeSsmlToStreamAsync($ssml)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
  $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
  $n = Await ($reader.LoadAsync([uint32]$stream.Size)) ([uint32])
  $bytes = New-Object byte[] $n
  $reader.ReadBytes($bytes)
  [IO.File]::WriteAllBytes((Join-Path $OutDir "$k.wav"), $bytes)
  Write-Output ("wrote $k " + $n)
}
