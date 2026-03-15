/* -----------------------------------------------------------------------
   Qwen3 TTS — frontend logic
   ----------------------------------------------------------------------- */

const MAX_TEXT_LENGTH = 5000;
const WARN_THRESHOLD  = 0.85;
const STORAGE_KEY     = "qwen3tts_state";

// DOM references (resolved after DOMContentLoaded)
let els = {};

function $(id) { return document.getElementById(id); }

document.addEventListener("DOMContentLoaded", () => {
  els = {
    helpBtn:        $("helpBtn"),
    helpPanel:      $("helpPanel"),
    statusDot:      $("statusDot"),
    statusText:     $("statusText"),
    textInput:      $("textInput"),
    charCount:      $("charCount"),
    charMax:        $("charMax"),
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
    leadSilence:    $("leadSilence"),
    tailSilence:    $("tailSilence"),
    generateBtn:    $("generateBtn"),
    generateLabel:  $("generateLabel"),
    resultCard:     $("resultCard"),
    audioPlayer:    $("audioPlayer"),
    downloadLink:   $("downloadLink"),
    elapsedBadge:   $("elapsedBadge"),
    errorBox:       $("errorBox"),
  };

  els.charCounterEl = document.querySelector(".char-counter");

  initHelp();
  initSliders();
  initCollapsible();
  initCharCounter();
  initPersistence();
  els.generateBtn.addEventListener("click", handleGenerate);
  loadOptions();
  pollHealth();
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function saveState() {
  const format = document.querySelector('input[name="format"]:checked');
  const state = {
    text:         els.textInput.value,
    speaker:      els.speakerSelect.value,
    language:     els.languageSelect.value,
    instruct:     els.instructInput.value,
    upsample:     els.upsampleCheck.checked,
    targetSr:     els.targetSrSelect.value,
    normalize:    els.normalizeCheck.checked,
    softClip:     els.softClipCheck.checked,
    drive:        els.driveSlider.value,
    stereo:       els.stereoCheck.checked,
    delay:        els.delaySlider.value,
    leadSilence:  els.leadSilence.value,
    tailSilence:  els.tailSilence.value,
    format:       format ? format.value : "wav",
    ppExpanded:   els.ppToggle.getAttribute("aria-expanded") === "true",
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage full */ }
}

function restoreState() {
  let state;
  try { state = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return; }
  if (!state) return;

  if (state.text        != null) els.textInput.value        = state.text;
  if (state.instruct    != null) els.instructInput.value    = state.instruct;
  if (state.upsample    != null) els.upsampleCheck.checked  = state.upsample;
  if (state.normalize   != null) els.normalizeCheck.checked = state.normalize;
  if (state.softClip    != null) els.softClipCheck.checked  = state.softClip;
  if (state.stereo      != null) els.stereoCheck.checked    = state.stereo;
  if (state.leadSilence != null) els.leadSilence.value      = state.leadSilence;
  if (state.tailSilence != null) els.tailSilence.value      = state.tailSilence;

  if (state.drive != null) {
    els.driveSlider.value       = state.drive;
    els.driveVal.textContent    = parseFloat(state.drive).toFixed(1);
  }
  if (state.delay != null) {
    els.delaySlider.value       = state.delay;
    els.delayVal.textContent    = state.delay;
  }
  if (state.targetSr != null) {
    els.targetSrSelect.value = state.targetSr;
  }
  if (state.format != null) {
    const radio = document.querySelector(`input[name="format"][value="${state.format}"]`);
    if (radio) radio.checked = true;
  }
  if (state.ppExpanded != null) {
    els.ppToggle.setAttribute("aria-expanded", String(state.ppExpanded));
    els.ppBody.hidden = !state.ppExpanded;
  }

  // Selects populated by API — deferred to restoreSelectState()
  els._savedSpeaker  = state.speaker;
  els._savedLanguage = state.language;

  updateCharCount();
}

// Called after the API populates the speaker/language dropdowns
function restoreSelectState() {
  if (els._savedSpeaker)  els.speakerSelect.value  = els._savedSpeaker;
  if (els._savedLanguage) els.languageSelect.value = els._savedLanguage;
  updateSpeakerHint();
}

function initPersistence() {
  restoreState();

  // Save on any change
  const inputs = [
    els.textInput, els.instructInput,
    els.upsampleCheck, els.normalizeCheck, els.softClipCheck, els.stereoCheck,
    els.driveSlider, els.delaySlider,
    els.targetSrSelect, els.speakerSelect, els.languageSelect,
    els.leadSilence, els.tailSilence,
  ];
  inputs.forEach(el => el.addEventListener("input", saveState));
  inputs.forEach(el => el.addEventListener("change", saveState));
  document.querySelectorAll('input[name="format"]').forEach(r => r.addEventListener("change", saveState));
  els.ppToggle.addEventListener("click", () => setTimeout(saveState, 0));
}

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
    ok:         ["ok",    label ?? "Ready"],
    warn:       ["busy",  label ?? "Warning"],
    error:      ["error", label ?? "Error"],
    loading:    ["busy",  label ?? "Loading…"],
    connecting: ["",      label ?? "Connecting…"],
    generating: ["busy",  label ?? "Generating…"],
  };
  const [cls, txt] = map[state] ?? ["", state];
  if (cls) dot.classList.add(cls);
  text.textContent = txt;
}

// ---------------------------------------------------------------------------
// Load options from API
// ---------------------------------------------------------------------------

const speakerDescriptions = {};

async function loadOptions() {
  try {
    const res  = await fetch("/api/options");
    const data = await res.json();

    populateSelect(els.speakerSelect, data.speakers);
    populateSelect(els.languageSelect, data.languages);

    data.speakers.forEach(s => { speakerDescriptions[s.id] = s.description; });

    // Restore saved selections now that options exist
    restoreSelectState();

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
  els.speakerHint.textContent = speakerDescriptions[els.speakerSelect.value] ?? "";
}

function populateSelect(sel, items) {
  sel.innerHTML = "";
  items.forEach(item => {
    const opt = document.createElement("option");
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
// Help panel
// ---------------------------------------------------------------------------

function initHelp() {
  els.helpBtn.addEventListener("click", () => {
    const open = els.helpBtn.getAttribute("aria-expanded") === "true";
    els.helpBtn.setAttribute("aria-expanded", String(!open));
    els.helpPanel.hidden = open;
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
  if (len >= max)       el.classList.add("limit");
  else if (len >= warn) el.classList.add("warn");
}

// ---------------------------------------------------------------------------
// Generate
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
    speaker:            els.speakerSelect.value,
    language:           els.languageSelect.value,
    instruct:           els.instructInput.value.trim(),
    upsample:           els.upsampleCheck.checked,
    target_sample_rate: parseInt(els.targetSrSelect.value, 10),
    normalize:          els.normalizeCheck.checked,
    soft_clip:          els.softClipCheck.checked,
    soft_clip_drive:    parseFloat(els.driveSlider.value),
    pseudo_stereo:      els.stereoCheck.checked,
    stereo_delay_ms:    parseFloat(els.delaySlider.value),
    lead_silence_ms:    Math.max(0, parseFloat(els.leadSilence.value) || 0),
    tail_silence_ms:    Math.max(0, parseFloat(els.tailSilence.value) || 0),
    output_format:      document.querySelector('input[name="format"]:checked').value,
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
      try { detail = (await res.json()).detail ?? detail; } catch { /* ignore */ }
      throw new Error(detail);
    }

    const blob    = await res.blob();
    const url     = URL.createObjectURL(blob);
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    const serverTime = res.headers.get("X-Generation-Time");
    const displayTime = serverTime ? `${parseFloat(serverTime).toFixed(2)}s` : `${elapsed}s`;

    showResult(url, payload.output_format, displayTime);
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
  els.generateLabel.innerHTML = active
    ? '<span class="spinner"></span> Generating…'
    : '&#9654; Generate';
}

function showResult(url, ext, elapsed) {
  const prev = els.audioPlayer.src;
  if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
  els.audioPlayer.src = url;
  els.downloadLink.href = url;
  els.downloadLink.download = `tts_output.${ext}`;
  els.elapsedBadge.textContent = `(${elapsed})`;
  els.resultCard.hidden = false;
}

function hideResult() { els.resultCard.hidden = true; }

function showError(msg) {
  els.errorBox.textContent = msg;
  els.errorBox.hidden = false;
}

function hideError() {
  els.errorBox.hidden = true;
  els.errorBox.textContent = "";
}
