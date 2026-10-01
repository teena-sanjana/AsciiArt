(function () {
  // ---------- Theme toggle ----------
  const themeToggle = document.getElementById('theme-toggle');
  const root = document.documentElement;

  function applyThemeIcon() {
    const isLight = root.getAttribute('data-theme') === 'light';
    themeToggle.textContent = isLight ? '☀️' : '🌙';
  }
  applyThemeIcon();

  themeToggle.addEventListener('click', () => {
    const isLight = root.getAttribute('data-theme') === 'light';
    if (isLight) {
      root.removeAttribute('data-theme');
      localStorage.setItem('ascii-theme', 'dark');
    } else {
      root.setAttribute('data-theme', 'light');
      localStorage.setItem('ascii-theme', 'light');
    }
    applyThemeIcon();
  });

  // ---------- Main app ----------
  const fileInput = document.getElementById('file-input');
  const resolutionSlider = document.getElementById('resolution');
  const resVal = document.getElementById('res-val');
  const contrastSlider = document.getElementById('contrast');
  const contrastVal = document.getElementById('contrast-val');
  const colorToggle = document.getElementById('color-toggle');
  const invertToggle = document.getElementById('invert-toggle');
  const boldToggle = document.getElementById('bold-toggle');
  const output = document.getElementById('ascii-output');
  const canvas = document.getElementById('hidden-canvas');
  const ctx = canvas.getContext('2d');
  const copyBtn = document.getElementById('copy-btn');
  const downloadBtn = document.getElementById('download-btn');
  const generateBtn = document.getElementById('generate-btn');
  const fileStatus = document.getElementById('file-status');
  const fileStatusText = document.getElementById('file-status-text');
  const thumb = document.getElementById('thumb');

  // Character ramp from darkest/densest to lightest/sparsest.
  // A wider ramp (70 chars) gives smoother gradients than a short one — less visible "banding."
  const RAMP = "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ";

  let currentImage = null;
  let hasGeneratedOnce = false;
  let lastPlainText = "";

  // Sliders/toggles only re-render live once something has already been generated
  resolutionSlider.addEventListener('input', () => {
    resVal.textContent = resolutionSlider.value;
    if (hasGeneratedOnce) render();
  });
  contrastSlider.addEventListener('input', () => {
    contrastVal.textContent = parseFloat(contrastSlider.value).toFixed(1);
    if (hasGeneratedOnce) render();
  });
  colorToggle.addEventListener('change', () => { if (hasGeneratedOnce) render(); });
  invertToggle.addEventListener('change', () => { if (hasGeneratedOnce) render(); });
  boldToggle.addEventListener('change', () => { if (hasGeneratedOnce) render(); });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) {
      resetFileStatus();
      return;
    }
    const img = new Image();
    img.onload = () => {
      currentImage = img;
      hasGeneratedOnce = false;
      generateBtn.disabled = false;
      fileStatus.classList.add('has-file');
      fileStatusText.textContent = `✓ ${file.name} ready`;
      thumb.src = img.src;
      thumb.classList.add('show');
      output.innerHTML = '<span class="placeholder">Image loaded — click "Generate" to convert →</span>';
    };
    img.onerror = () => {
      resetFileStatus();
      output.innerHTML = '<span class="placeholder">Could not load that image. Try another file.</span>';
    };
    img.src = URL.createObjectURL(file);
  });

  function resetFileStatus() {
    currentImage = null;
    hasGeneratedOnce = false;
    generateBtn.disabled = true;
    fileStatus.classList.remove('has-file');
    fileStatusText.textContent = "No image selected";
    thumb.classList.remove('show');
  }

  generateBtn.addEventListener('click', () => {
    if (!currentImage) return;
    hasGeneratedOnce = true;
    render();
  });

  function render() {
    if (!currentImage) return;

    const cols = parseInt(resolutionSlider.value, 10);
    const contrast = parseFloat(contrastSlider.value);
    const isColor = colorToggle.checked;
    const isInverted = invertToggle.checked;
    const isBold = boldToggle.checked;

    // --- Draw the full-resolution image to a canvas so we can read real pixel data ---
    const srcW = currentImage.width;
    const srcH = currentImage.height;
    canvas.width = srcW;
    canvas.height = srcH;
    ctx.drawImage(currentImage, 0, 0, srcW, srcH);

    let srcData;
    try {
      srcData = ctx.getImageData(0, 0, srcW, srcH).data;
    } catch (err) {
      output.innerHTML = '<span class="placeholder">Could not read pixel data from this image (possibly a cross-origin image).</span>';
      return;
    }

    // --- Figure out the real width:height ratio of a monospace character ---
    // Instead of guessing a fixed correction factor, measure the actual font.
    const probeCtx = document.createElement('canvas').getContext('2d');
    probeCtx.font = '16px "SF Mono", "Courier New", monospace';
    const charWidth = probeCtx.measureText('M').width;
    const charHeight = 16 * 1.0; // approx line height at this font size
    const charAspect = charWidth / charHeight; // typically ~0.5-0.6

    const rows = Math.max(1, Math.round((cols * (srcH / srcW)) * charAspect));

    // --- Manually average each source block into one output cell (more accurate than relying on drawImage's built-in downscale) ---
    const blockW = srcW / cols;
    const blockH = srcH / rows;

    const rampLen = RAMP.length;
    let htmlOut = "";
    let plainOut = "";

    for (let cellY = 0; cellY < rows; cellY++) {
      const yStart = Math.floor(cellY * blockH);
      const yEnd = Math.max(yStart + 1, Math.floor((cellY + 1) * blockH));

      for (let cellX = 0; cellX < cols; cellX++) {
        const xStart = Math.floor(cellX * blockW);
        const xEnd = Math.max(xStart + 1, Math.floor((cellX + 1) * blockW));

        let rSum = 0, gSum = 0, bSum = 0, aSum = 0, count = 0;

        for (let y = yStart; y < yEnd; y++) {
          const rowOffset = y * srcW * 4;
          for (let x = xStart; x < xEnd; x++) {
            const idx = rowOffset + x * 4;
            rSum += srcData[idx];
            gSum += srcData[idx + 1];
            bSum += srcData[idx + 2];
            aSum += srcData[idx + 3];
            count++;
          }
        }

        const r = rSum / count;
        const g = gSum / count;
        const b = bSum / count;
        const avgAlpha = aSum / count;

        // Fully transparent block → blank space
        if (avgAlpha < 8) {
          htmlOut += " ";
          plainOut += " ";
          continue;
        }

        // Perceived luminance (0-1)
        let brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

        // Gamma correction — human perception of brightness is non-linear,
        // so this keeps midtones from skewing too dark or too light.
        const gamma = 0.8;
        brightness = Math.pow(brightness, gamma);

        // Apply contrast around midpoint 0.5
        brightness = (brightness - 0.5) * contrast + 0.5;
        brightness = Math.min(1, Math.max(0, brightness));

        if (isInverted) brightness = 1 - brightness;

        let charIndex = Math.floor((1 - brightness) * (rampLen - 1));
        charIndex = Math.min(rampLen - 1, Math.max(0, charIndex));
        const char = RAMP[charIndex];
        const safeChar = char === " " ? "&nbsp;" : char;

        plainOut += char;

        // Darker pixels → heavier font-weight. Mapped to the 100-900 numeric range;
        // note many monospace fonts only truly render a couple of distinct weights,
        // but this still adds visible density variation in fonts that support it.
        const weight = isBold ? Math.round(100 + (1 - brightness) * 800) : null;

        const styleParts = [];
        if (isColor) styleParts.push(`color:rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`);
        if (isBold) styleParts.push(`font-weight:${weight}`);

        if (styleParts.length) {
          htmlOut += `<span style="${styleParts.join(';')}">${safeChar}</span>`;
        } else {
          htmlOut += safeChar;
        }
      }
      htmlOut += "\n";
      plainOut += "\n";
    }

    output.innerHTML = htmlOut;
    lastPlainText = plainOut;

    // Auto-size font so the whole thing fits nicely
    const targetWidthPx = 900;
    const fontSize = Math.max(2, Math.min(10, targetWidthPx / cols / 0.6));
    output.style.fontSize = fontSize + "px";
  }

  copyBtn.addEventListener('click', () => {
    if (!lastPlainText) return;
    navigator.clipboard.writeText(lastPlainText).then(() => {
      const original = copyBtn.textContent;
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = original), 1200);
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = lastPlainText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = "Copy Text"), 1200);
    });
  });

  downloadBtn.addEventListener('click', () => {
    if (!lastPlainText) return;
    const blob = new Blob([lastPlainText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = "ascii-art.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
})();
