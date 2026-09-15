// ---------------------------------------------------------------------------
// VAULT — Profile photo picker + crop
// A single shared crop screen used both when creating a profile and when
// changing an existing one's photo from Settings. window.openPhotoPicker(cb)
// opens the file picker, then the crop screen, and calls cb(dataUrl) once
// the user confirms — cb is never called if they cancel.
// ---------------------------------------------------------------------------

const VIEWPORT_SIZE = 280; // must match .crop-viewport's CSS size
const OUTPUT_SIZE = 256;

const cropScreen = document.getElementById("photo-crop-screen");
const cropViewport = document.getElementById("crop-viewport");
const cropImage = document.getElementById("crop-image");
const cropZoomSlider = document.getElementById("crop-zoom-slider");
const photoFileInput = document.getElementById("photo-file-input");

const cropState = {
  naturalW: 0,
  naturalH: 0,
  baseScale: 1,
  zoom: 1,
  panX: 0,
  panY: 0,
  dragging: false,
  startX: 0,
  startY: 0,
  startPanX: 0,
  startPanY: 0,
  callback: null
};

window.openPhotoPicker = function (callback) {
  cropState.callback = callback;
  photoFileInput.value = "";
  photoFileInput.click();
};

photoFileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    cropImage.onload = () => {
      cropState.naturalW = cropImage.naturalWidth;
      cropState.naturalH = cropImage.naturalHeight;
      // "Cover" scale — the smallest zoom where the image still fills the
      // circular viewport with no empty gaps.
      cropState.baseScale = Math.max(VIEWPORT_SIZE / cropState.naturalW, VIEWPORT_SIZE / cropState.naturalH);
      cropState.zoom = 1;
      cropState.panX = 0;
      cropState.panY = 0;
      cropZoomSlider.value = 1;
      updateImageTransform();
      cropScreen.classList.add("visible");
    };
    cropImage.src = reader.result;
  };
  reader.readAsDataURL(file);
});

function updateImageTransform() {
  const totalScale = cropState.baseScale * cropState.zoom;
  cropImage.style.width = `${cropState.naturalW * totalScale}px`;
  cropImage.style.height = `${cropState.naturalH * totalScale}px`;
  cropImage.style.transform = `translate(-50%, -50%) translate(${cropState.panX}px, ${cropState.panY}px)`;
}

function clampPan() {
  const totalScale = cropState.baseScale * cropState.zoom;
  const dispW = cropState.naturalW * totalScale;
  const dispH = cropState.naturalH * totalScale;
  const maxPanX = Math.max(0, (dispW - VIEWPORT_SIZE) / 2);
  const maxPanY = Math.max(0, (dispH - VIEWPORT_SIZE) / 2);
  cropState.panX = Math.min(maxPanX, Math.max(-maxPanX, cropState.panX));
  cropState.panY = Math.min(maxPanY, Math.max(-maxPanY, cropState.panY));
}

// --- Drag to pan (pointer events cover touch, mouse, and pen) ------------------
cropViewport.addEventListener("pointerdown", (e) => {
  cropState.dragging = true;
  cropState.startX = e.clientX;
  cropState.startY = e.clientY;
  cropState.startPanX = cropState.panX;
  cropState.startPanY = cropState.panY;
});

cropViewport.addEventListener("pointermove", (e) => {
  if (!cropState.dragging) return;
  cropState.panX = cropState.startPanX + (e.clientX - cropState.startX);
  cropState.panY = cropState.startPanY + (e.clientY - cropState.startY);
  clampPan();
  updateImageTransform();
});

function stopDrag() {
  cropState.dragging = false;
}
cropViewport.addEventListener("pointerup", stopDrag);
cropViewport.addEventListener("pointercancel", stopDrag);
cropViewport.addEventListener("pointerleave", stopDrag);

// --- Zoom slider -----------------------------------------------------------------
cropZoomSlider.addEventListener("input", (e) => {
  cropState.zoom = parseFloat(e.target.value);
  clampPan();
  updateImageTransform();
});

// --- Cancel / confirm --------------------------------------------------------------
document.getElementById("crop-cancel-btn").addEventListener("click", () => {
  cropScreen.classList.remove("visible");
  cropState.callback = null;
  photoFileInput.value = "";
});

document.getElementById("crop-confirm-btn").addEventListener("click", () => {
  const totalScale = cropState.baseScale * cropState.zoom;
  const dispW = cropState.naturalW * totalScale;
  const dispH = cropState.naturalH * totalScale;

  // Map the visible viewport square back to natural-image pixel coordinates.
  const srcX = (dispW / 2 - VIEWPORT_SIZE / 2 - cropState.panX) / totalScale;
  const srcY = (dispH / 2 - VIEWPORT_SIZE / 2 - cropState.panY) / totalScale;
  const srcSize = VIEWPORT_SIZE / totalScale;

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  canvas.getContext("2d").drawImage(cropImage, srcX, srcY, srcSize, srcSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

  cropScreen.classList.remove("visible");
  photoFileInput.value = "";
  const cb = cropState.callback;
  cropState.callback = null;
  if (cb) cb(dataUrl);
});
