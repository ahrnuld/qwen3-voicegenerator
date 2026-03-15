import logging
import os
from pathlib import Path

import numpy as np
import torch

logger = logging.getLogger(__name__)

MODEL_IDS = {
    "custom_voice": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    "voice_design": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
    "voice_clone":  "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
}

# If VOICEGEN_MODEL_DIR is set (or a local ./models/ folder exists), prefer that
# over downloading from HuggingFace.
_MODEL_BASE_DIR: Path | None = None
_env = os.environ.get("VOICEGEN_MODEL_DIR")
if _env:
    _MODEL_BASE_DIR = Path(_env)
    logger.info("Using local model directory: %s", _MODEL_BASE_DIR)
elif Path("models").is_dir():
    _MODEL_BASE_DIR = Path("models")
    logger.info("Found local ./models/ directory — will use it if model folders exist.")


def _resolve_model_path(mode: str) -> str:
    """Return a local path if the model folder exists there, otherwise the HF repo ID."""
    if _MODEL_BASE_DIR is not None:
        folder_name = MODEL_IDS[mode].split("/")[-1]   # e.g. Qwen3-TTS-12Hz-1.7B-CustomVoice
        local = _MODEL_BASE_DIR / folder_name
        if local.is_dir() and any(local.iterdir()):
            logger.info("Loading %s from local path: %s", mode, local)
            return str(local)
    return MODEL_IDS[mode]


class TTSEngine:
    """
    Manages both Qwen3-TTS model variants.
    Each model is lazy-loaded on first use and kept resident in VRAM.
    """

    def __init__(self):
        self._models: dict[str, object] = {}

    def _load_model(self, mode: str) -> None:
        if mode in self._models:
            return

        from qwen_tts import Qwen3TTSModel

        device_map = "cuda:0" if torch.cuda.is_available() else "cpu"
        dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
        model_path = _resolve_model_path(mode)
        logger.info("Loading %s (%s, %s)...", model_path, device_map, dtype)

        self._models[mode] = Qwen3TTSModel.from_pretrained(
            model_path,
            dtype=dtype,
            attn_implementation="sdpa",
            device_map=device_map,
        )
        logger.info("%s loaded.", model_path)

    def load(self) -> None:
        """Pre-load the CustomVoice model at startup (fast path for first request)."""
        self._load_model("custom_voice")

    @property
    def is_loaded(self) -> bool:
        return "custom_voice" in self._models

    def loaded_modes(self) -> list[str]:
        return list(self._models.keys())

    def generate(
        self,
        text: str,
        mode: str = "custom_voice",
        speaker: str = "vivian",
        language: str = "auto",
        instruct: str = "",
        ref_audio: tuple | None = None,   # (np.ndarray, sr) for voice_clone
        ref_text: str = "",
        x_vector_only: bool = False,
    ) -> tuple[np.ndarray, int]:
        """
        Run TTS inference. Lazy-loads the requested model if not yet in memory.

        Returns (waveform: float32 ndarray, sample_rate: int).
        """
        if mode not in MODEL_IDS:
            raise ValueError(f"Unknown mode: {mode!r}. Use 'custom_voice' or 'voice_design'.")

        self._load_model(mode)
        model = self._models[mode]

        chunks = _split_text(text)
        audio_parts: list[np.ndarray] = []
        sample_rate: int = 24000

        for chunk in chunks:
            if not chunk.strip():
                continue
            with torch.inference_mode():
                if mode == "custom_voice":
                    wavs, sr = model.generate_custom_voice(
                        text=chunk,
                        speaker=speaker,
                        language=language,
                        instruct=instruct or None,
                    )
                elif mode == "voice_design":
                    wavs, sr = model.generate_voice_design(
                        text=chunk,
                        language=language,
                        instruct=instruct or None,
                    )
                else:  # voice_clone
                    if ref_audio is None:
                        raise ValueError("ref_audio is required for voice_clone mode.")
                    wavs, sr = model.generate_voice_clone(
                        text=chunk,
                        language=language,
                        ref_audio=ref_audio,
                        ref_text=ref_text or None,
                        x_vector_only_mode=x_vector_only,
                    )

            sample_rate = sr
            waveform = wavs[0]
            if isinstance(waveform, torch.Tensor):
                waveform = waveform.float().cpu().numpy()
            audio_parts.append(waveform)

        if not audio_parts:
            raise ValueError("No audio was generated.")

        return np.concatenate(audio_parts, axis=-1) if len(audio_parts) > 1 else audio_parts[0], sample_rate


def _split_text(text: str, max_chars: int = 800) -> list[str]:
    import re
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        if len(current) + len(sentence) + 1 <= max_chars:
            current = (current + " " + sentence).strip()
        else:
            if current:
                chunks.append(current)
            current = sentence
    if current:
        chunks.append(current)
    return chunks


# Module-level singleton
engine = TTSEngine()
