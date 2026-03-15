# Qwen3 TTS — Local Web App

A single-user local web app for generating voice lines with `Qwen3-TTS-12Hz-1.7B-CustomVoice`.

## Requirements

- Python 3.10+
- NVIDIA GPU with CUDA (recommended)
- `ffmpeg` on PATH (required for MP3 export only)

## Setup

```bash
pip install -r requirements.txt
```

> **Note:** `torch` and `torchaudio` should be installed with the CUDA variant matching your system.
> See https://pytorch.org/get-started/locally/ for the right install command.

## Run

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open [http://localhost:8000](http://localhost:8000) in your browser.

The model loads once on startup (~30–60 s on first run while weights are cached). Subsequent requests are fast.

## Usage

1. Enter text (up to 5 000 characters).
2. Choose a speaker and language.
3. Optionally expand **Post-Processing** to configure upsampling, normalization, soft clipping, and pseudo-stereo.
4. Choose WAV or MP3 output.
5. Click **Generate** and wait.
6. Play the audio inline or download it.
