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
  checkReminders();
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

// ---- Notifications ----

// In the Android app, reminders are scheduled with the system so they fire
// even when the app is closed. In a browser they only show while it's open.
const Native = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins.LocalNotifications : null;

// Android notification ids must be integers; derive a stable one per line.
function notificationId(line, slot) {
  let h = 0;
  for (const c of line.id) h = (h * 31 + c.charCodeAt(0)) % 100000000;
  return h * 10 + slot;
}

function at9am(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9, 0, 0);
}

async function scheduleNative() {
  const pending = await Native.getPending();
  if (pending.notifications.length) {
    await Native.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  }

  const now = new Date();
  const notifications = [];
  for (const line of lines) {
    const expiry = parseDate(line.expiry);
    const remindDay = new Date(expiry.getTime() - line.remind * DAY);
    const slots = [
      [1, at9am(remindDay), `${line.label} expires in ${line.remind} day(s). Time to recharge.`],
      [2, at9am(expiry), `${line.label} expires today. Recharge it now.`],
    ];
    for (const [slot, when, body] of slots) {
      if (when <= now || (slot === 1 && line.remind === 0)) continue;
      notifications.push({
        id: notificationId(line, slot),
        title: "Recharge Reminder",
        body,
        schedule: { at: when, allowWhileIdle: true },
      });
    }
  }
  if (notifications.length) await Native.schedule({ notifications });
}

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

// Native: (re)schedule everything. Browser: notify at most once per line per day.
function checkReminders() {
  if (Native) {
    scheduleNative().catch((e) => console.error("Scheduling failed", e));
    return;
  }
  const notified = load(NOTIFIED_KEY, {});
  const key = toDateString(today());
  for (const line of lines) {
    if (daysLeft(line) > line.remind || notified[line.id] === key) continue;
    notify(reminderText(line));
    notified[line.id] = key;
  }
  save(NOTIFIED_KEY, notified);
}

async function permissionState() {
  if (Native) return (await Native.checkPermissions()).display;
  return "Notification" in window ? Notification.permission : "unsupported";
}

async function updateNotifyButton() {
  const btn = $("notify-btn");
  const state = await permissionState();
  btn.hidden = state === "unsupported";
  btn.textContent =
    state === "granted" ? "Notifications on" :
    state === "denied" ? "Notifications blocked" : "Turn on notifications";
}

$("notify-btn").addEventListener("click", async () => {
  if (Native) await Native.requestPermissions();
  else if ("Notification" in window) await Notification.requestPermission();
  await updateNotifyButton();
  checkReminders();
});

// ---- Start ----

if (Native) {
  // Calendar files can't be downloaded inside the app, and aren't needed there.
  document.body.classList.add("native");
  Native.requestPermissions().finally(updateNotifyButton);
} else if ("serviceWorker" in navigator) {
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
