"""Checks a rendered video's voice-over against the script.

    python tools/check-vo.py [out/stillpaid-demo.mp4]

Transcribes the audio (faster-whisper, local), prints where each scene's
first words are heard, and lists words that are missing or different.
"""

import difflib
import re
import sys
from pathlib import Path

from faster_whisper import WhisperModel

ROOT = Path(__file__).resolve().parent.parent
video = sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "out" / "stillpaid-demo.mp4")


def norm(text):
    return re.findall(
        r"[a-z0-9]+", text.lower().replace("stillpaid", "still paid").replace("-", " ")
    )


src = (ROOT / "src" / "script.ts").read_text(encoding="utf-8")
block = src[src.index("export const scenes") :]
scenes = [
    (m.group(1), " ".join(re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(2))))
    for m in re.finditer(r'id:\s*"(\w+)".*?lines:\s*\[(.*?)\]', block, re.S)
]

model = WhisperModel(
    "mobiuslabsgmbh/faster-whisper-large-v3-turbo", device="cpu", compute_type="int8"
)
segs, info = model.transcribe(
    video, language="en", word_timestamps=True, vad_filter=True
)
words = [(t, w.start) for s in segs for w in (s.words or []) for t in norm(w.word)]
print(f"audio {info.duration:.1f} s, {len(words)} words heard")

tokens = [t for t, _ in words]
for scene, text in scenes:
    opening = norm(text)[:5]
    best = max(
        range(len(tokens)),
        key=lambda i: difflib.SequenceMatcher(None, opening, tokens[i : i + 5]).ratio(),
    )
    print(
        f"{scene:11s} starts at {words[best][1]:6.1f} s: {' '.join(tokens[best : best + 6])}"
    )

want = [t for _, text in scenes for t in norm(text)]
sm = difflib.SequenceMatcher(None, want, tokens)
print(f"match {sm.ratio():.1%} ({len(want)} words in script)")
for op, a1, a2, b1, b2 in sm.get_opcodes():
    if op != "equal":
        print(
            f"  {op}: script '{' '.join(want[a1:a2])}' / heard '{' '.join(tokens[b1:b2])}'"
        )
