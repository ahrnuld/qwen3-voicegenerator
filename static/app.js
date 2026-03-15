/* -----------------------------------------------------------------------
   Qwen3 TTS — frontend logic
   ----------------------------------------------------------------------- */

const MAX_TEXT_LENGTH = 5000;
const WARN_THRESHOLD   = 0.85; // show warning at 85 % of limit

// DOM references (resolved after DOMContentLoaded)
let els = {};

function $(id) { return document.getElementById(id); }

document.addEventListener("DOMContentLoaded", () => {
  els = {
    statusDot:      $("statusDot"),
    statusText:     $("statusText"),
    textInput:      $("textInput"),
    charCount:      $("charCount"),
    charMax:        $("charMax"),
    charCounter:    $("textInput").closest
      ? $("textInput").parentElement.querySelector(".char-counter")
      : null,
    speakerSelect:  $("speakerSelect"),
    speakerHint:    $("speakerHint"),
    languageSelect: $("languageSelect"),
    instructInput:  $("instructInput"),
    ppToggle:       $("ppToggle"),
    ppBody:         $("ppBody"),
    upsampleCheck:  $("upsampleCheck"),
    targetSrSelect: $("targetSrSelect"),
    normalizeCheck: $("normalizeCheck"),
    softClipCheck:  $("softClipCheck"),
    driveSlider:    $("driveSlider"),
    driveVal:       $("driveVal"),
    stereoCheck:    $("stereoCheck"),
    delaySlider:    $("delaySlider"),
    delayVal:       $("delayVal"),
    generateBtn:    $("generateBtn"),
    generateLabel:  $("generateLabel"),
    resultCard:     $("resultCard"),
    audioPlayer:    $("audioPlayer"),
    downloadLink:   $("downloadLink"),
    elapsedBadge:   $("elapsedBadge"),
    errorBox:       $("errorBox"),
  };

  // Re-find char-counter by class since .closest is on the textarea element
  els.charCounterEl = document.querySelector(".char-counter");

  initSliders();
  initCollapsible();
  initCharCounter();
  els.generateBtn.addEventListener("click", handleGenerate);
  loadOptions();
  pollHealth();
});

// ---------------------------------------------------------------------------
// Health polling
// ---------------------------------------------------------------------------

async function pollHealth() {
  setStatus("connecting");
  try {
    const res  = await fetch("/api/health");
    const data = await res.json();

    if (data.model_loaded && data.cuda_available) {
      setStatus("ok", data.cuda_device ? `GPU: ${data.cuda_device}` : "Ready");
      els.generateBtn.disabled = false;
    } else if (data.model_loaded && !data.cuda_available) {
      setStatus("warn", "No GPU — CPU mode");
      els.generateBtn.disabled = false;
    } else {
      setStatus("loading", "Model loading…");
      setTimeout(pollHealth, 3000);
    }
  } catch {
    setStatus("error", "Server unreachable");
    setTimeout(pollHealth, 5000);
  }
}

function setStatus(state, label) {
  const dot  = els.statusDot;
  const text = els.statusText;

  dot.className = "status-dot";

  const map = {
    ok:          ["ok",    label ?? "Ready"],
    warn:        ["busy",  label ?? "Warning"],
    error:       ["error", label ?? "Error"],
    loading:     ["busy",  label ?? "Loading…"],
    connecting:  ["",      label ?? "Connecting…"],
    generating:  ["busy",  label ?? "Generating…"],
  };

  const [cls, txt] = map[state] ?? ["", state];
  if (cls) dot.classList.add(cls);
  text.textContent = txt;
}

// ---------------------------------------------------------------------------
// Load options from API
// ---------------------------------------------------------------------------

// speakerDescriptions is populated from /api/options
const speakerDescriptions = {};

async function loadOptions() {
  try {
    const res  = await fetch("/api/options");
    const data = await res.json();

    populateSelect(els.speakerSelect, data.speakers);
    populateSelect(els.languageSelect, data.languages);

    // Build description map and wire up hint
    data.speakers.forEach(s => { speakerDescriptions[s.id] = s.description; });
    updateSpeakerHint();
    els.speakerSelect.addEventListener("change", updateSpeakerHint);

    if (data.max_text_length) {
      els.charMax.textContent = data.max_text_length;
      els.textInput.maxLength = data.max_text_length;
    }
  } catch (err) {
    console.error("Failed to load options:", err);
  }
}

function updateSpeakerHint() {
  const id = els.speakerSelect.value;
  els.speakerHint.textContent = speakerDescriptions[id] ?? "";
}

function populateSelect(sel, items) {
  sel.innerHTML = "";
  items.forEach(item => {
    const opt = document.createElement("option");
    // items are either {id, label} objects or plain strings
    if (typeof item === "object") {
      opt.value = item.id;
      opt.textContent = item.label;
    } else {
      opt.value = item;
      opt.textContent = item;
    }
    sel.appendChild(opt);
  });
}

// ---------------------------------------------------------------------------
// Collapsible post-processing section
// ---------------------------------------------------------------------------

function initCollapsible() {
  els.ppToggle.addEventListener("click", () => {
    const expanded = els.ppToggle.getAttribute("aria-expanded") === "true";
    els.ppToggle.setAttribute("aria-expanded", String(!expanded));
    els.ppBody.hidden = expanded;
  });
}

// ---------------------------------------------------------------------------
// Sliders
// ---------------------------------------------------------------------------

function initSliders() {
  els.driveSlider.addEventListener("input", () => {
    els.driveVal.textContent = parseFloat(els.driveSlider.value).toFixed(1);
  });
  els.delaySlider.addEventListener("input", () => {
    els.delayVal.textContent = els.delaySlider.value;
  });
}

// ---------------------------------------------------------------------------
// Character counter
// ---------------------------------------------------------------------------

function initCharCounter() {
  els.textInput.addEventListener("input", updateCharCount);
  updateCharCount();
}

function updateCharCount() {
  const len  = els.textInput.value.length;
  const max  = parseInt(els.charMax.textContent, 10) || MAX_TEXT_LENGTH;
  const warn = Math.floor(max * WARN_THRESHOLD);

  els.charCount.textContent = len;
  const el = els.charCounterEl;
  if (!el) return;
  el.classList.remove("warn", "limit");
  if (len >= max)  el.classList.add("limit");
  else if (len >= warn) el.classList.add("warn");
}

// ---------------------------------------------------------------------------
// Generate  (listener wired in DOMContentLoaded below)
// ---------------------------------------------------------------------------

async function handleGenerate() {
  const text = els.textInput.value.trim();
  if (!text) {
    showError("Please enter some text.");
    return;
  }

  hideError();
  hideResult();
  setGenerating(true);
  setStatus("generating");

  const payload = {
    text,
    speaker:           els.speakerSelect.value,
    language:          els.languageSelect.value,
    instruct:          els.instructInput.value.trim(),
    upsample:          els.upsampleCheck.checked,
    target_sample_rate: parseInt(els.targetSrSelect.value, 10),
    normalize:         els.normalizeCheck.checked,
    soft_clip:         els.softClipCheck.checked,
    soft_clip_drive:   parseFloat(els.driveSlider.value),
    pseudo_stereo:     els.stereoCheck.checked,
    stereo_delay_ms:   parseFloat(els.delaySlider.value),
    output_format:     document.querySelector('input[name="format"]:checked').value,
  };

  const t0 = performance.now();

  try {
    const res = await fetch("/api/generate", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        detail = err.detail ?? detail;
      } catch { /* ignore */ }
      throw new Error(detail);
    }

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const ext  = payload.output_format;
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);

    // Use server-reported time if available
    const serverTime = res.headers.get("X-Generation-Time");
    const displayTime = serverTime ? `${parseFloat(serverTime).toFixed(2)}s` : `${elapsed}s`;

    showResult(url, ext, displayTime);
    setStatus("ok", "Ready");
  } catch (err) {
    showError(err.message || "An unknown error occurred.");
    setStatus("ok", "Ready");
  } finally {
    setGenerating(false);
  }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function setGenerating(active) {
  els.generateBtn.disabled = active;
  if (active) {
    els.generateLabel.innerHTML = '<span class="spinner"></span> Generating…';
  } else {
    els.generateLabel.innerHTML = '&#9654; Generate';
  }
}

function showResult(url, ext, elapsed) {
  // Revoke previous object URL to avoid memory leaks
  const prev = els.audioPlayer.src;
  if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);

  els.audioPlayer.src = url;
  els.downloadLink.href = url;
  els.downloadLink.download = `tts_output.${ext}`;
  els.elapsedBadge.textContent = `(${elapsed})`;
  els.resultCard.hidden = false;
}

function hideResult() {
  els.resultCard.hidden = true;
}

function showError(msg) {
  els.errorBox.textContent = msg;
  els.errorBox.hidden = false;
}

function hideError() {
  els.errorBox.hidden = true;
  els.errorBox.textContent = "";
}
