"""Turns one voice-over take into the per-scene files the video expects.

    python tools/split-vo.py <aufnahme.m4a|wav|mp3> [--model <faster-whisper model>]

1. Cleans the audio: rumble filter, noise reduction, gentle compression,
   loudness normalised to -16 LUFS, long pauses shortened.
2. Transcribes it with word timestamps (faster-whisper, runs locally).
3. Finds where each scene starts by its opening words. If a scene was read
   twice, the last take wins, so a flubbed sentence can simply be repeated.
4. Writes public/vo/<scene>.mp3 and public/vo/transcript.json, and prints how
   closely each scene matches the script (the subtitles come from the script).
"""

import argparse
import difflib
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "vo"


def scenes_from_script():
    """Scene ids and lines, read from src/script.ts so there is one source."""
    src = (ROOT / "src" / "script.ts").read_text(encoding="utf-8")
    block = src[src.index("export const scenes") :]
    out = []
    for m in re.finditer(r'id:\s*"(\w+)".*?lines:\s*\[(.*?)\]', block, re.S):
        lines = re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(2))
        out.append((m.group(1), " ".join(lines)))
    return out


def words(text):
    text = text.lower().replace("stillpaid", "still paid").replace("-", " ")
    return re.findall(r"[a-z0-9]+", text)


def ffmpeg(*args):
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True
    )


def clean(src, dst):
    ffmpeg(
        "-i",
        str(src),
        "-ac",
        "1",
        "-ar",
        "48000",
        "-af",
        ",".join(
            [
                "highpass=f=80",
                "afftdn=nf=-25",
                "acompressor=threshold=-20dB:ratio=3:attack=5:release=120",
                "silenceremove=stop_periods=-1:stop_duration=0.9:stop_threshold=-45dB:stop_silence=0.45",
                "loudnorm=I=-16:TP=-1.5:LRA=11",
            ]
        ),
        str(dst),
    )


def transcribe(path, model_name):
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segs, _ = model.transcribe(
        str(path),
        language="en",
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
    )
    out = []
    for s in segs:
        for w in s.words or []:
            for token in words(w.word):
                out.append((token, w.start, w.end))
    return out


def matches(tokens, phrase, lo, hi):
    """Where `phrase` is spoken in tokens[lo:hi]: one best index per occurrence."""
    hits = []
    for i in range(lo, hi):
        score = difflib.SequenceMatcher(None, phrase, tokens[i : i + len(phrase)]).ratio()
        if score < 0.6:
            continue
        # Neighbouring windows of the same occurrence also score; keep the best.
        if hits and i - hits[-1][0] < len(phrase) // 2 + 1:
            if score > hits[-1][1]:
                hits[-1] = (i, score)
        else:
            hits.append((i, score))
    return hits


def find_starts(spoken, scenes):
    """Each scene starts at the last take of its opening words, walking from the end."""
    tokens = [t for t, _, _ in spoken]
    starts = [0] * len(scenes)
    limit = len(tokens)
    for k in range(len(scenes) - 1, -1, -1):
        opening = words(scenes[k][1])[:6]
        hits = matches(tokens, opening, 0, limit)
        if not hits:
            sys.exit(f"Scene '{scenes[k][0]}' not found. Did you read it? Opening: {' '.join(opening)}")
        starts[k] = hits[-1][0]
        limit = starts[k]
    return starts


def find_end(spoken, text, lo, hi):
    """End of the scene's closing words; drops anything transcribed after them."""
    tokens = [t for t, _, _ in spoken]
    closing = words(text)[-4:]
    hits = matches(tokens, closing, lo, hi)
    return min(hits[-1][0] + len(closing), hi) - 1 if hits else hi - 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--model", default="mobiuslabsgmbh/faster-whisper-large-v3-turbo")
    args = ap.parse_args()
    scenes = scenes_from_script()
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        cleaned = Path(tmp) / "clean.wav"
        print("cleaning audio ...")
        clean(args.audio, cleaned)
        print(f"transcribing with {args.model} ...")
        spoken = transcribe(cleaned, args.model)
        starts = find_starts(spoken, scenes)
        report = []
        for k, (scene, text) in enumerate(scenes):
            first = starts[k]
            last = find_end(
                spoken, text, first, starts[k + 1] if k + 1 < len(scenes) else len(spoken)
            )
            begin = max(0.0, spoken[first][1] - 0.15)
            end = spoken[last][2] + 0.3
            said = " ".join(t for t, _, _ in spoken[first : last + 1])
            match = difflib.SequenceMatcher(None, words(text), said.split()).ratio()
            ffmpeg(
                "-ss",
                f"{begin:.3f}",
                "-to",
                f"{end:.3f}",
                "-i",
                str(cleaned),
                "-af",
                "afade=t=in:d=0.05,areverse,afade=t=in:d=0.12,areverse",
                "-codec:a",
                "libmp3lame",
                "-q:a",
                "2",
                str(OUT / f"{scene}.mp3"),
            )
            report.append(
                {
                    "scene": scene,
                    "seconds": round(end - begin, 1),
                    "match": round(match, 2),
                    "said": said,
                }
            )
            flag = (
                ""
                if match >= 0.85
                else "   <- differs from the script, check the subtitles"
            )
            print(f"{scene:11s} {end - begin:5.1f} s  match {match:.0%}{flag}")
        (OUT / "transcript.json").write_text(
            json.dumps(report, indent=2), encoding="utf-8"
        )
        total = sum(r["seconds"] for r in report)
        print(f"total speech {total:.0f} s files in {OUT}")


if __name__ == "__main__":
    main()
