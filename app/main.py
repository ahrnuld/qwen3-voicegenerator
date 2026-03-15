import logging
import time
from contextlib import asynccontextmanager

import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .schemas import GenerateRequest
from .tts_engine import engine
from .audio_processing import build_pipeline

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan: load model on startup, release on shutdown
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up — loading TTS model...")
    engine.load()
    logger.info("TTS model ready. Open http://localhost:8000 in your browser.")
    yield
    logger.info("Shutting down.")


app = FastAPI(title="Qwen3 TTS", lifespan=lifespan)


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------


@app.get("/api/health")
async def health():
    return {
        "model_loaded": engine.is_loaded,
        "cuda_available": torch.cuda.is_available(),
        "cuda_device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
    }


@app.get("/api/options")
async def options():
    return {
        "speakers": [
            {"id": "vivian",    "label": "Vivian",    "description": "Female · English · Expressive and versatile"},
            {"id": "ryan",      "label": "Ryan",      "description": "Male · English · Clear, natural American accent"},
            {"id": "eric",      "label": "Eric",      "description": "Male · English · Confident, professional"},
            {"id": "serena",    "label": "Serena",    "description": "Female · English · Warm, conversational"},
            {"id": "aiden",     "label": "Aiden",     "description": "Male · English · Young, energetic"},
            {"id": "dylan",     "label": "Dylan",     "description": "Male · English · Relaxed, casual"},
            {"id": "uncle_fu",  "label": "Uncle Fu",  "description": "Male · Mandarin-accented · Authoritative, elder"},
            {"id": "ono_anna",  "label": "Ono Anna",  "description": "Female · Japanese-accented · Clear, articulate"},
            {"id": "sohee",     "label": "Sohee",     "description": "Female · Korean-accented · Bright, expressive"},
        ],
        "languages": [
            {"id": "auto",       "label": "Auto-detect"},
            {"id": "english",    "label": "English"},
            {"id": "chinese",    "label": "Chinese"},
            {"id": "french",     "label": "French"},
            {"id": "german",     "label": "German"},
            {"id": "italian",    "label": "Italian"},
            {"id": "japanese",   "label": "Japanese"},
            {"id": "korean",     "label": "Korean"},
            {"id": "portuguese", "label": "Portuguese"},
            {"id": "russian",    "label": "Russian"},
            {"id": "spanish",    "label": "Spanish"},
        ],
        "sample_rates": [22050, 44100, 48000],
        "max_text_length": 5000,
    }


@app.post("/api/generate")
async def generate(req: GenerateRequest):
    if not engine.is_loaded:
        raise HTTPException(status_code=503, detail="Model is not loaded yet. Try again shortly.")

    t0 = time.perf_counter()
    logger.info(
        "Generating: speaker=%s lang=%s len=%d upsample=%s normalize=%s clip=%s stereo=%s fmt=%s",
        req.speaker,
        req.language,
        len(req.text),
        req.upsample,
        req.normalize,
        req.soft_clip,
        req.pseudo_stereo,
        req.output_format,
    )

    try:
        audio, orig_sr = engine.generate(req.text, speaker=req.speaker, language=req.language, instruct=req.instruct)
    except torch.cuda.OutOfMemoryError as exc:
        logger.error("GPU OOM: %s", exc)
        raise HTTPException(
            status_code=507,
            detail="GPU out of memory. Try shorter text or restart the server.",
        ) from exc
    except Exception as exc:
        logger.exception("Inference error")
        raise HTTPException(status_code=500, detail=f"Inference failed: {exc}") from exc

    pipeline = build_pipeline(
        upsample=req.upsample,
        target_sr=req.target_sample_rate,
        normalize=req.normalize,
        soft_clip_enabled=req.soft_clip,
        soft_clip_drive=req.soft_clip_drive,
        pseudo_stereo=req.pseudo_stereo,
        stereo_delay_ms=req.stereo_delay_ms,
        output_format=req.output_format,
    )

    try:
        buf, content_type = pipeline(audio, orig_sr)
    except Exception as exc:
        logger.exception("Post-processing error")
        raise HTTPException(status_code=500, detail=f"Post-processing failed: {exc}") from exc

    elapsed = time.perf_counter() - t0
    logger.info("Done in %.2fs", elapsed)

    ext = req.output_format
    filename = f"tts_output.{ext}"

    return StreamingResponse(
        buf,
        media_type=content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Generation-Time": f"{elapsed:.2f}",
        },
    )


# ---------------------------------------------------------------------------
# Static files + root redirect
# ---------------------------------------------------------------------------


@app.get("/")
async def root():
    return RedirectResponse(url="/index.html")


app.mount("/", StaticFiles(directory="static", html=True), name="static")
