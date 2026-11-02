"use strict";
const search = document.querySelector("#search");
search?.addEventListener("input", () => {
  let visible = 0;
  document.querySelectorAll("[data-search-row]").forEach((row) => {
    row.hidden = !row.textContent
      .toLowerCase()
      .includes(search.value.toLowerCase());
    if (!row.hidden) visible++;
  });
  document.querySelector(".search-empty").hidden = visible !== 0;
});
const input = document.querySelector("#file-input"),
  zone = document.querySelector("#dropzone"),
  clear = document.querySelector("#clear-file");
function fileChanged() {
  const file = input.files[0];
  const invalid =
    file &&
    (file.size > 20 * 1024 * 1024 || !file.name.toLowerCase().endsWith(".pdf"));
  document.querySelector("#filename").textContent = file
    ? file.name
    : "Original NHS ESR payslips · Up to 20 MB";
  document.querySelector("#file-error").textContent = invalid
    ? "Choose a PDF of at most 20 MB."
    : "";
  document.querySelector("#upload-submit").disabled = !!invalid;
}
if (input) {
  input.addEventListener("change", fileChanged);
  clear.addEventListener("click", () => {
    input.value = "";
    fileChanged();
  });
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    if (e.dataTransfer.files.length !== 1) {
      document.querySelector("#file-error").textContent =
        "Choose one PDF at a time.";
      return;
    }
    input.files = e.dataTransfer.files;
    fileChanged();
  });
  document.querySelector("#upload-form").addEventListener("submit", () => {
    document.querySelector("#upload-submit").disabled = true;
    document.querySelector("#upload-status").textContent =
      "Uploading and checking your payslip…";
  });
}
const sync = document.querySelector("#sync-now");
sync?.addEventListener("click", async () => {
  const status = document.querySelector("#sync-status");
  sync.disabled = true;
  status.textContent = "Requesting sync…";
  try {
    const r = await fetch("/api/imports/sync", {
      method: "POST",
      headers: {
        "x-csrf-token": document.querySelector("meta[name=csrf-token]").content,
      },
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    status.textContent =
      "Sync requested. Refresh shortly to see the latest imports.";
  } catch (e) {
    status.textContent = e.message;
  } finally {
    sync.disabled = false;
  }
});
const draft = document.querySelector("#draft");
if (draft) {
  let data = JSON.parse(draft.value);
  const editor = document.querySelector("#field-editor");
  let fields = [];
  const title = (s) =>
    s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  function render() {
    editor.replaceChildren();
    fields = [];
    function walk(value, path, parent) {
      if (value && typeof value === "object") {
        const box = document.createElement("fieldset");
        box.className = "field-section";
        const legend = document.createElement("legend");
        legend.textContent = title(path.at(-1) || "Payslip");
        box.append(legend);
        Object.entries(value).forEach(([k, v]) => walk(v, [...path, k], box));
        parent.append(box);
      } else {
        const label = document.createElement("label");
        label.textContent = title(path.at(-1));
        const input = document.createElement("input");
        input.value = value ?? "";
        if (path[0] === "filename") input.readOnly = true;
        label.append(input);
        parent.append(label);
        input.addEventListener("input", () => {
          const totals = ["total_payments", "total_deductions", "net_pay"];
          const key = path.at(-1);
          if (
            totals.includes(key) &&
            (path.length === 1 || path[0] === "this_period_summary")
          ) {
            fields
              .filter(
                (f) =>
                  f.path.at(-1) === key &&
                  (f.path.length === 1 || f.path[0] === "this_period_summary"),
              )
              .forEach((f) => {
                f.input.value = input.value;
              });
          }
        });
        fields.push({ input, path });
      }
    }
    walk(data, [], editor);
  }
  render();
  draft.addEventListener("change", () => {
    try {
      data = JSON.parse(draft.value);
      render();
      draft.setCustomValidity("");
    } catch {
      draft.setCustomValidity("Enter valid JSON.");
    }
  });
  document.querySelector("#review-form").addEventListener("submit", () => {
    for (const { input, path } of fields) {
      let target = data;
      for (const key of path.slice(0, -1)) target = target[key];
      target[path.at(-1)] =
        target[path.at(-1)] === null && input.value === "" ? null : input.value;
    }
    draft.value = JSON.stringify(data);
  });
}
