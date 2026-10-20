# 口號語音：把 Windows 語音（tools/voice_tts.ps1 產生的 wav）做成「魔性」的稱讚聲（像 Candy Crush 的 Sweet! Delicious!）
# 用法（在專案根目錄）:
#   powershell -ExecutionPolicy Bypass -File tools\voice_tts.ps1 -OutDir tools\out\voice    # 產生原始語音（台灣華語男聲 Zhiwei）
#   python tools/voice_fx.py tools/out/voice assets/voice                                    # 加效果，輸出遊戲用的 wav
# 效果：降 3 個半音（變慢、變低沉）、加一層稍微錯開的和聲（厚度）、殘響、壓縮、音量標準化
import os, sys, wave
import numpy as np
from scipy import signal

SR_OUT = 22050
SEMITONES = -3.0


def read(path):
    with wave.open(path, 'rb') as w:
        sr, n, ch, sw = w.getframerate(), w.getnframes(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(n)
    a = np.frombuffer(raw, dtype=np.int16 if sw == 2 else np.uint8).astype(np.float32)
    if sw != 2:
        a = (a - 128) * 256
    a = a.reshape(-1, ch).mean(1) / 32768.0
    return a, sr


def write(path, a, sr):
    a = np.clip(a, -1, 1)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((a * 32767).astype(np.int16).tobytes())


def trim(a, thr=0.012, pad=0.03, sr=22050):
    idx = np.where(np.abs(a) > thr)[0]
    if not len(idx):
        return a
    p = int(pad * sr)
    return a[max(0, idx[0] - p): idx[-1] + p]


def process(a, sr):
    # 先重新取樣到輸出取樣率，再用「慢放」降調：音高和速度一起變低，聽起來誇張又有份量
    a = signal.resample_poly(a, SR_OUT, sr)
    a = trim(a, sr=SR_OUT)
    k = 2 ** (SEMITONES / 12)
    n = int(len(a) / k)
    low = signal.resample(a, n)
    # 和聲：同一句再高一點點、晚 22ms，混小聲（厚實、有點魔幻）
    k2 = 2 ** ((SEMITONES + 0.35) / 12)
    dbl = signal.resample(a, int(len(a) / k2))
    d = int(0.022 * SR_OUT)
    out = np.zeros(max(len(low), len(dbl) + d) + int(1.2 * SR_OUT), np.float32)
    out[:len(low)] += low
    out[d:d + len(dbl)] += 0.42 * dbl
    # 低音加厚一點、太高的嘶聲壓下來
    b, aa = signal.butter(2, [70 / (SR_OUT / 2), 7000 / (SR_OUT / 2)], 'band')
    out = signal.lfilter(b, aa, out)
    lowshelf = signal.lfilter(*signal.butter(2, 350 / (SR_OUT / 2), 'low'), out)
    out = out + 0.35 * lowshelf
    # 殘響：指數衰減的雜訊脈衝
    rng = np.random.default_rng(7)
    L = int(0.9 * SR_OUT)
    ir = rng.standard_normal(L) * np.exp(-np.linspace(0, 7, L))
    ir = signal.lfilter(*signal.butter(1, 3000 / (SR_OUT / 2), 'low'), ir)
    ir /= np.sqrt((ir ** 2).sum())
    wet = signal.fftconvolve(out, ir)[:len(out)]
    out = out + 0.28 * wet
    # 簡單壓縮 + 標準化到 -1 dBFS
    env = np.abs(signal.hilbert(out))
    env = signal.lfilter([0.002], [1, -0.998], env)
    gain = np.minimum(1.0, (0.25 / np.maximum(env, 1e-4)) ** 0.5)
    out = out * gain
    out = trim(out, thr=0.004, pad=0.05, sr=SR_OUT)
    out /= max(1e-6, np.abs(out).max()) / 0.89
    f = int(0.01 * SR_OUT)
    out[:f] *= np.linspace(0, 1, f); out[-f * 4:] *= np.linspace(1, 0, f * 4)
    return out.astype(np.float32)


def main(src, dst):
    os.makedirs(dst, exist_ok=True)
    for n in sorted(os.listdir(src)):
        if not n.endswith('.wav'):
            continue
        a, sr = read(os.path.join(src, n))
        out = process(a, sr)
        write(os.path.join(dst, n), out, SR_OUT)
        print(f'  {n}: {len(out) / SR_OUT:.2f}s, {os.path.getsize(os.path.join(dst, n)) // 1024} KB')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
