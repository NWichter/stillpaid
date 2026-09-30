"""Voice-over for every scene with ElevenLabs, from the lines in src/script.ts.

    python tools/tts-vo.py [--voice JBFqnCBsd6RMkjVDRZzb] [--model eleven_v4]

Needs ELEVENLABS_API_KEY (environment or the project's .env).
Writes public/vo/<scene>.mp3; the video stretches each scene to its audio.
"""

import argparse
import json
import os
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "vo"


def scenes():
    src = (ROOT / "src" / "script.ts").read_text(encoding="utf-8")
    block = src[src.index("export const scenes") :]
    for m in re.finditer(r'id:\s*"(\w+)".*?lines:\s*\[(.*?)\]', block, re.S):
        yield m.group(1), " ".join(re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(2)))


def api_key():
    if os.environ.get("ELEVENLABS_API_KEY"):
        return os.environ["ELEVENLABS_API_KEY"]
    for line in (ROOT.parent / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("ELEVENLABS_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit("ELEVENLABS_API_KEY is not set")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="JBFqnCBsd6RMkjVDRZzb")  # George
    ap.add_argument("--model", default="eleven_v4")
    ap.add_argument("--only", nargs="*", help="scene ids to (re)generate")
    args = ap.parse_args()
    key = api_key()
    OUT.mkdir(parents=True, exist_ok=True)
    all_scenes = list(scenes())
    for i, (scene, text) in enumerate(all_scenes):
        if args.only and scene not in args.only:
            continue
        body = {
            "text": text,
            "model_id": args.model,
            # Neighbouring scenes keep the intonation consistent across files.
            "previous_text": all_scenes[i - 1][1] if i else None,
            "next_text": all_scenes[i + 1][1] if i + 1 < len(all_scenes) else None,
        }
        req = urllib.request.Request(
            f"https://api.elevenlabs.io/v1/text-to-speech/{args.voice}?output_format=mp3_44100_128",
            data=json.dumps(body).encode(),
            headers={"xi-api-key": key, "content-type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=120) as r:
            (OUT / f"{scene}.mp3").write_bytes(r.read())
        print(f"{scene}: {len(text)} characters")


if __name__ == "__main__":
    main()
