const STORAGE_KEY = "recharge-reminder:lines";
const NOTIFIED_KEY = "recharge-reminder:notified";
const DAY = 24 * 60 * 60 * 1000;

const $ = (id) => document.getElementById(id);

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked (private mode); the app still works for this visit.
  }
}

let lines = load(STORAGE_KEY, []);

// Dates are stored as "YYYY-MM-DD" and compared at local midnight.
function parseDate(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toDateString(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function today() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function daysLeft(line) {
  return Math.round((parseDate(line.expiry) - today()) / DAY);
}

function status(line) {
  const left = daysLeft(line);
  if (left < 0) return { cls: "danger", text: `Expired ${-left}d ago` };
  if (left === 0) return { cls: "danger", text: "Expires today" };
  if (left <= line.remind) return { cls: "warn", text: `${left}d left` };
  return { cls: "", text: `${left}d left` };
}

function formatDate(str) {
  return parseDate(str).toLocaleDateString(undefined, {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}

function render() {
  lines.sort((a, b) => daysLeft(a) - daysLeft(b));
  const list = $("lines");
  list.innerHTML = "";
  $("empty").hidden = lines.length > 0;

  for (const line of lines) {
    const s = status(line);
    const li = document.createElement("li");
    li.className = `line ${s.cls}`;
    li.innerHTML = `
      <div class="line-top">
        <div>
          <div class="line-name"></div>
          <div class="line-meta"></div>
          <div class="line-meta">Expires ${formatDate(line.expiry)}</div>
        </div>
        <span class="badge">${s.text}</span>
      </div>
      <div class="line-actions">
        <button class="small-btn" data-act="recharged">I recharged</button>
        <button class="small-btn ghost" data-act="calendar">Add to calendar</button>
        <button class="small-btn ghost" data-act="edit">Edit</button>
        <button class="small-btn ghost" data-act="delete">Delete</button>
      </div>`;
    li.querySelector(".line-name").textContent = line.label;
    li.querySelector(".line-meta").textContent =
      [line.carrier, line.number].filter(Boolean).join(" · ");
    li.querySelectorAll("button").forEach((btn) =>
      btn.addEventListener("click", () => handleAction(btn.dataset.act, line.id))
    );
    list.appendChild(li);
  }

  renderAlerts();
}

function renderAlerts() {
  const box = $("alerts");
  box.innerHTML = "";
  for (const line of lines) {
    const left = daysLeft(line);
    if (left > line.remind) continue;
    const div = document.createElement("div");
    div.className = left <= 0 ? "alert danger" : "alert";
    div.textContent = reminderText(line);
    box.appendChild(div);
  }
}

function reminderText(line) {
  const left = daysLeft(line);
  if (left < 0) return `${line.label} expired ${-left} day(s) ago. Recharge it now.`;
  if (left === 0) return `${line.label} expires today. Recharge it now.`;
  return `${line.label} expires in ${left} day(s). Time to recharge.`;
}

function handleAction(act, id) {
  const line = lines.find((l) => l.id === id);
  if (!line) return;

  if (act === "recharged") {
    // New validity starts from today if already expired, otherwise from the current expiry.
    const base = daysLeft(line) < 0 ? today() : parseDate(line.expiry);
    line.expiry = toDateString(new Date(base.getTime() + line.validity * DAY));
    clearNotified(line.id);
    persist();
  } else if (act === "calendar") {
    downloadIcs(line);
  } else if (act === "edit") {
    startEdit(line);
  } else if (act === "delete") {
    if (confirm(`Delete ${line.label}?`)) {
      lines = lines.filter((l) => l.id !== id);
      persist();
    }
  }
}

function persist() {
  save(STORAGE_KEY, lines);
  render();
}

// ---- Form ----

function resetForm() {
  $("line-form").reset();
  $("edit-id").value = "";
  $("remind").value = 3;
  $("validity").value = 30;
  $("expiry").value = toDateString(new Date(today().getTime() + 30 * DAY));
  $("form-title").textContent = "Add a line";
  $("save-btn").textContent = "Add line";
  $("cancel-btn").hidden = true;
}

function startEdit(line) {
  $("edit-id").value = line.id;
  $("label").value = line.label;
  $("number").value = line.number;
  $("carrier").value = line.carrier;
  $("expiry").value = line.expiry;
  $("remind").value = line.remind;
  $("validity").value = line.validity;
  $("form-title").textContent = "Edit line";
  $("save-btn").textContent = "Save changes";
  $("cancel-btn").hidden = false;
  $("line-form").scrollIntoView({ behavior: "smooth" });
}

$("line-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const data = {
    label: $("label").value.trim(),
    number: $("number").value.trim(),
    carrier: $("carrier").value,
    expiry: $("expiry").value,
    remind: Number($("remind").value),
    validity: Number($("validity").value),
  };
  const editId = $("edit-id").value;
  if (editId) {
    Object.assign(lines.find((l) => l.id === editId), data);
    clearNotified(editId);
  } else {
    lines.push({ id: crypto.randomUUID?.() ?? String(Date.now()), ...data });
  }
  persist();
  resetForm();
  checkReminders();
});

$("cancel-btn").addEventListener("click", resetForm);

// ---- Calendar export (works even when the app is closed) ----

function escIcs(text) {
  return text.replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
}

function downloadIcs(line) {
  const start = line.expiry.replaceAll("-", "");
  const end = toDateString(new Date(parseDate(line.expiry).getTime() + DAY)).replaceAll("-", "");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const title = escIcs(`Recharge ${line.label}${line.number ? " (" + line.number + ")" : ""}`);
  // The event starts at midnight; alarm at 9:00 on the chosen day before expiry.
  const hoursBefore = line.remind * 24 - 9;
  const trigger = hoursBefore > 0 ? `-PT${hoursBefore}H` : "PT9H";
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Recharge Reminder//EN",
    "BEGIN:VEVENT",
    `UID:${line.id}-${start}@recharge-reminder`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${title} - line expires`,
    `DESCRIPTION:Your ${escIcs(line.carrier)} line expires today. Recharge it to keep your number.`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${title}`,
    `TRIGGER:${trigger}`,
    "END:VALARM",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${title} - expires today`,
    "TRIGGER:PT9H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `recharge-${line.label.replace(/\W+/g, "-").toLowerCase()}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---- Notifications (shown while the app is open or opened) ----

function clearNotified(id) {
  const notified = load(NOTIFIED_KEY, {});
  delete notified[id];
  save(NOTIFIED_KEY, notified);
}

async function notify(text) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg) reg.showNotification("Recharge Reminder", { body: text, icon: "icon.svg" });
  else new Notification("Recharge Reminder", { body: text, icon: "icon.svg" });
}

// Notify at most once per line per day.
function checkReminders() {
  const notified = load(NOTIFIED_KEY, {});
  const key = toDateString(today());
  for (const line of lines) {
    if (daysLeft(line) > line.remind || notified[line.id] === key) continue;
    notify(reminderText(line));
    notified[line.id] = key;
  }
  save(NOTIFIED_KEY, notified);
}

function updateNotifyButton() {
  const btn = $("notify-btn");
  if (!("Notification" in window)) btn.hidden = true;
  else if (Notification.permission === "granted") btn.textContent = "Notifications on";
  else if (Notification.permission === "denied") btn.textContent = "Notifications blocked";
}

$("notify-btn").addEventListener("click", async () => {
  if (!("Notification" in window)) return;
  await Notification.requestPermission();
  updateNotifyButton();
  checkReminders();
});

// ---- Start ----

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

resetForm();
render();
updateNotifyButton();
checkReminders();

// Refresh countdowns and reminders while the app stays open.
setInterval(() => { render(); checkReminders(); }, 60 * 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { render(); checkReminders(); }
});
