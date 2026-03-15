"""
Pre-download all Qwen3-TTS model weights to the HuggingFace cache.

Run this once before starting the server:
    python download_models.py

To download to a specific local folder instead of the default HF cache,
pass a directory path:
    python download_models.py --local-dir ./models

Once downloaded, the server will start instantly with no internet required.
"""

import argparse
import sys
from pathlib import Path

MODELS = {
    "custom_voice": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    "voice_design":  "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
    "voice_clone":   "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
}


def download(repo_id: str, local_dir: Path | None) -> None:
    from huggingface_hub import snapshot_download

    kwargs = dict(repo_id=repo_id)
    if local_dir is not None:
        dest = local_dir / repo_id.split("/")[-1]
        dest.mkdir(parents=True, exist_ok=True)
        kwargs["local_dir"] = str(dest)
        print(f"  → {dest}")
    else:
        print(f"  → HuggingFace cache (~/.cache/huggingface/hub/)")

    snapshot_download(**kwargs)


def main() -> None:
    parser = argparse.ArgumentParser(description="Download Qwen3-TTS model weights.")
    parser.add_argument(
        "--local-dir",
        metavar="DIR",
        help="Download into DIR/<model-name>/ instead of the HF cache.",
    )
    parser.add_argument(
        "--models",
        nargs="+",
        choices=list(MODELS.keys()) + ["all"],
        default=["all"],
        help="Which models to download (default: all).",
    )
    args = parser.parse_args()

    local_dir = Path(args.local_dir) if args.local_dir else None
    targets = list(MODELS.keys()) if "all" in args.models else args.models

    try:
        import huggingface_hub  # noqa: F401
    except ImportError:
        print("ERROR: huggingface_hub is not installed.")
        print("       Run: pip install huggingface_hub")
        sys.exit(1)

    total = len(targets)
    for i, key in enumerate(targets, 1):
        repo_id = MODELS[key]
        print(f"\n[{i}/{total}] Downloading {key}: {repo_id}")
        try:
            download(repo_id, local_dir)
            print(f"  ✓ Done")
        except Exception as exc:
            print(f"  ✗ Failed: {exc}")
            sys.exit(1)

    print("\nAll models downloaded. You can now start the server.")
    if local_dir:
        print(f"\nAdd this to your uvicorn command or set the env var:")
        print(f"  set VOICEGEN_MODEL_DIR={local_dir.resolve()}")


if __name__ == "__main__":
    main()
