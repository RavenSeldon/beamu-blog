(function () {
  function randomKey() {
    if (window.crypto && crypto.getRandomValues) {
      const bytes = new Uint8Array(4);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    }

    return Math.random().toString(36).slice(2, 10);
  }

  function getEditorForTextarea(textarea) {
    if (!textarea) return null;

    if (textarea.EasyMDE && textarea.EasyMDE.codemirror) {
      return textarea.EasyMDE;
    }

    if (
      window.EasyMDEInstances &&
      textarea.id &&
      window.EasyMDEInstances[textarea.id] &&
      window.EasyMDEInstances[textarea.id].codemirror
    ) {
      return window.EasyMDEInstances[textarea.id];
    }

    return null;
  }

  function syncEditorToTextarea(textarea) {
    const editor = getEditorForTextarea(textarea);

    if (editor && editor.codemirror) {
      textarea.value = editor.codemirror.getValue();
    }
  }

  function insertAtCursor(textarea, token) {
    if (!textarea) return;

    const insertion = `\n\n${token}\n\n`;
    const editor = getEditorForTextarea(textarea);

    if (editor && editor.codemirror) {
      const cm = editor.codemirror;
      cm.replaceSelection(insertion);
      cm.focus();
      textarea.value = cm.getValue();
      return;
    }

    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const value = textarea.value || "";

    textarea.value =
      value.slice(0, start) +
      insertion +
      value.slice(end);

    const cursor = start + insertion.length;
    textarea.selectionStart = cursor;
    textarea.selectionEnd = cursor;
    textarea.focus();
  }

  function escapeAttr(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function createCard(studio, state, file) {
    const list = studio.querySelector("#image-studio-list");
    const card = document.createElement("div");

    card.className = "image-studio-card";
    card.dataset.key = state.key;
    card.dataset.kind = state.kind;

    if (state.kind === "existing") {
      card.dataset.associationId = String(state.association_id || "");
    }

    const previewUrl = file ? URL.createObjectURL(file) : state.preview_url;

    card.innerHTML = `
      <div class="image-studio-preview-wrap">
        ${
          previewUrl
            ? `<img class="image-studio-preview" src="${previewUrl}" alt="">`
            : `<div class="image-studio-preview image-studio-preview-empty">No preview</div>`
        }
      </div>

      <div class="image-studio-fields">
        <div class="image-studio-token">
          <code>[[img:${state.key}]]</code>
        </div>

        <label>
          Caption
          <input
            type="text"
            class="image-studio-caption"
            maxlength="512"
            value="${escapeAttr(state.caption || "")}"
          >
        </label>

        <label>
          Alt text
          <input
            type="text"
            class="image-studio-alt"
            maxlength="512"
            value="${escapeAttr(state.alt_text || "")}"
          >
        </label>

        <label>
          Alignment
          <select class="image-studio-alignment">
            <option value="center">Center</option>
            <option value="full">Full width</option>
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
        </label>

        <div class="image-studio-actions">
          <button type="button" class="image-studio-insert">
            Insert into body
          </button>

          <button type="button" class="image-studio-remove">
            Remove
          </button>
        </div>
      </div>
    `;

    const alignment = card.querySelector(".image-studio-alignment");
    alignment.value = state.alignment || "center";

    if (file) {
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.name = `gallery_${state.key}`;
      fileInput.className = "image-studio-hidden-file";

      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;

      fileInput.style.display = "none";
      card.appendChild(fileInput);
    }

    card
      .querySelector(".image-studio-insert")
      .addEventListener("click", function () {
        const textarea = document.getElementById(studio.dataset.bodyFieldId);
        insertAtCursor(textarea, `[[img:${state.key}]]`);
      });

    card
      .querySelector(".image-studio-remove")
      .addEventListener("click", function () {
        card.remove();
        updateManifest(studio);
      });

    card.addEventListener("input", function () {
      updateManifest(studio);
    });

    card.addEventListener("change", function () {
      updateManifest(studio);
    });

    list.appendChild(card);
    updateManifest(studio);
  }

  function updateManifest(studio) {
    const manifestInput = studio.querySelector("#gallery-manifest");
    const cards = Array.from(studio.querySelectorAll(".image-studio-card"));

    const manifest = {};

    cards.forEach((card, index) => {
      const key = card.dataset.key;
      const kind = card.dataset.kind;

      if (!key || !kind) {
        return;
      }

      const entry = {
        kind: kind,
        caption: card.querySelector(".image-studio-caption").value || "",
        alt_text: card.querySelector(".image-studio-alt").value || "",
        alignment: card.querySelector(".image-studio-alignment").value || "center",
        position: index
      };

      if (kind === "existing") {
        const associationId = parseInt(card.dataset.associationId, 10);

        if (!Number.isInteger(associationId) || associationId <= 0) {
          console.warn("Skipping existing gallery card with invalid association id:", key);
          return;
        }

        if (studio.dataset.galleryOwner === "project") {
          entry.project_image_id = associationId;
        } else {
          entry.post_image_id = associationId;
        }
      }

      manifest[key] = entry;
    });

    manifestInput.value = JSON.stringify(manifest);
  }

  function loadExisting(studio) {
    const list = studio.querySelector("#image-studio-list");
    let existing = [];

    try {
      existing = JSON.parse(list.dataset.existingGallery || "[]");
    } catch (error) {
      console.warn("Could not parse existing gallery data:", error);
      existing = [];
    }

    existing.forEach((image) => {
      if (!image.key || !image.association_id) {
        console.warn("Skipping malformed existing gallery image:", image);
        return;
      }

      createCard(studio, {
        key: image.key,
        association_id: image.association_id,
        kind: "existing",
        caption: image.caption || "",
        alt_text: image.alt_text || "",
        alignment: image.alignment || "center",
        position: image.position || 0,
        preview_url: image.preview_url || null
      });
    });
  }

  function initImageStudio(studio) {
    // The script is currently included both globally (base.html) and per-form
    // (extra_js), so guard against double-initialization: without this, loadExisting
    // runs twice and every existing image renders as two identical cards.
    if (studio.dataset.studioInitialized === "1") {
      return;
    }
    studio.dataset.studioInitialized = "1";

    const fileInput = studio.querySelector("#image-studio-file-input");

    if (!fileInput) {
      return;
    }

    loadExisting(studio);

    fileInput.addEventListener("change", function () {
      Array.from(fileInput.files || []).forEach((file) => {
        const key = randomKey();

        createCard(
          studio,
          {
            key: key,
            kind: "new",
            caption: "",
            alt_text: "",
            alignment: "center",
            position: 0,
            preview_url: null
          },
          file
        );
      });

      fileInput.value = "";
    });

    const form = studio.closest("form");

    if (form) {
      form.addEventListener("submit", function () {
        const textarea = document.getElementById(studio.dataset.bodyFieldId);
        syncEditorToTextarea(textarea);
        updateManifest(studio);
      });
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".image-studio").forEach(initImageStudio);
  });
})();