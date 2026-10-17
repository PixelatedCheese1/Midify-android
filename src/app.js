import { WorkletSynthesizer, Sequencer } from "spessasynth_lib";
import { BasicMIDI } from "spessasynth_core";
import { Filesystem, Directory } from "@capacitor/filesystem";

/* ---------- icons ---------- */
const I = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M6 5v14l10-7zm11 0h2v14h-2z"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M18 5v14L8 12zM5 5h2v14H5z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24"><path d="M17 3h4v4l-1.5-1.5-4 4-1.4-1.4 4-4zM3 6h3.6c1.3 0 2.5.6 3.3 1.6l7.6 9.4c.4.6 1.100 1 1.900 1H19l-1.500-1.500 1.400-1.400L22 17l-3.100 3.100-1.400-1.400L19 17.200h-.6c-1.400 0-2.600-.6-3.400-1.700L7.400 8.600A2 2 0 0 0 6.600 8H3zm0 10h3.600c.8 0 1.500-.4 2-1l1.100-1.400 1.500 1.700L10.300 17.300A4 4 0 0 1 6.600 18.100H3z"/></svg>',
  repeat: '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M19.400 13a7.500 7.500 0 0 0 0-2l2.100-1.600-2-3.400-2.500 1a7.600 7.600 0 0 0-1.700-1L15 3h-4l-.4 3a7.600 7.600 0 0 0-1.700 1l-2.500-1-2 3.400L6.600 11a7.500 7.500 0 0 0 0 2l-2.100 1.600 2 3.400 2.500-1c.5.400 1.100.7 1.700 1L11 21h4l.4-3c.6-.3 1.200-.6 1.700-1l2.500 1 2-3.400zM13 15.500a3.500 3.500 0 1 1 0-7 3.500 3.500 0 0 1 0 7z"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M7.400 8.600 12 13.200l4.600-4.600L18 10l-6 6-6-6z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="m15.400 5.400-6.600 6.600 6.600 6.600L14 20l-8-8 8-8z"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M12 3v10.600A4 4 0 1 0 14 17V7h5V3z"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 5h7l2 2h9v12H3z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
};

/* ---------- state ---------- */
const LS = "midify.v1";
const S = Object.assign({ shuffle: false, repeat: "off", override: false, sfName: "", volume: 1, skip: true, lastFolder: "" },
  JSON.parse(localStorage.getItem(LS) || "{}"));
const save = () => localStorage.setItem(LS, JSON.stringify(S));
let tracks = [];            // library
let order = [], pos = -1;   // play queue
let tab = "home", query = "";
let cur = null, playing = false, token = 0, sfLoaded = false;
let synth, seq, ctx, gain;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const toast = (m) => { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), 2600); };
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const hue = (str) => { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

/* ---------- soundfont storage (IndexedDB) ---------- */
const db = () => new Promise((res, rej) => { const r = indexedDB.open("midify", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const kv = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction("kv", mode); const rq = fn(tx.objectStore("kv")); tx.oncomplete = () => res(rq?.result); tx.onerror = () => rej(tx.error); }); };
const kvGet = (k) => kv("readonly", (s) => s.get(k));
const kvSet = (k, v) => kv("readwrite", (s) => s.put(v, k));
const kvDel = (k) => kv("readwrite", (s) => s.delete(k));

/* ---------- audio engine ---------- */
async function engine() {
  if (synth) { if (ctx.state !== "running") await ctx.resume(); return; }
  ctx = new AudioContext({ latencyHint: "playback" });
  await ctx.audioWorklet.addModule("spessasynth_processor.min.js");
  synth = new WorkletSynthesizer(ctx);
  gain = ctx.createGain(); gain.gain.value = S.volume;
  synth.connect(gain); gain.connect(ctx.destination);
  await synth.isReady;
  seq = new Sequencer(synth, { skipToFirstNoteOn: S.skip });
  seq.loopCount = 0;
  seq.eventHandler.addEvent("songEnded", "midify", () => {
    if (S.repeat === "one") { seq.currentTime = 0; seq.play(); } else next(true);
  });
  const sf = await kvGet("soundfont");
  if (sf) { await synth.soundBankManager.addSoundBank(sf, "user"); sfLoaded = true; }
  if (ctx.state !== "running") await ctx.resume();
}
async function setSoundfont(buf, name) {
  await kvSet("soundfont", buf);
  S.sfName = name; save();
  if (synth) {
    try { await synth.soundBankManager.deleteSoundBank("user"); } catch {}
    await synth.soundBankManager.addSoundBank(buf, "user");
  }
  sfLoaded = true;
}
async function clearSoundfont() {
  await kvDel("soundfont"); S.sfName = ""; save(); sfLoaded = false;
  if (synth) { try { await synth.soundBankManager.deleteSoundBank("user"); } catch {} }
}
(async () => { sfLoaded = !!(await kvGet("soundfont")); })();

/* ---------- file access ---------- */
const EXT = /\.(mid|midi|rmi|kar)$/i;
const b64ToBuf = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
async function readBytes(src) {
  if (src.file) return await src.file.arrayBuffer();
  const r = await Filesystem.readFile({ path: src.path, directory: Directory.ExternalStorage });
  return b64ToBuf(r.data);
}
async function walk(path, out, depth = 0) {
  const r = await Filesystem.readdir({ path, directory: Directory.ExternalStorage });
  for (const f of r.files) {
    const p = path ? path + "/" + f.name : f.name;
    if (f.type === "directory") { if (depth < 6) await walk(p, out, depth + 1); }
    else if (EXT.test(f.name)) out.push({ name: f.name, src: { path: p } });
  }
}
const sniffMime = (b) => { const u = new Uint8Array(b); return u[0] === 0x89 ? "image/png" : u[0] === 0x47 ? "image/gif" : u[0] === 0x52 ? "image/webp" : "image/jpeg"; };
function parse(bytes, name) {
  const stem = name.replace(/\.[^.]+$/, "");
  const t = { name, title: stem, artist: "Unknown artist", album: "", art: null, dur: 0, rmi: false };
  try {
    const m = BasicMIDI.fromArrayBuffer(bytes, name);
    t.title = (m.getRMIDInfo("name") || m.getName() || stem).toString().trim() || stem;
    t.artist = (m.getRMIDInfo("artist") || "").toString().trim() || t.artist;
    t.album = (m.getRMIDInfo("album") || "").toString().trim();
    const pic = m.getRMIDInfo("picture");
    if (pic && pic.byteLength > 16) t.art = URL.createObjectURL(new Blob([pic], { type: sniffMime(pic) }));
    t.dur = m.duration || 0;
    t.rmi = !!m.embeddedSoundBank || Object.keys(m.rmidiInfo || {}).length > 0;
  } catch (e) { console.warn("parse failed", name, e); }
  return t;
}
async function loadEntries(entries, label) {
  tracks.forEach((t) => t.art && URL.revokeObjectURL(t.art));
  tracks = []; let n = 0;
  for (const e of entries) {
    try {
      const t = parse(await readBytes(e.src), e.name);
      t.src = e.src; t.id = n++; tracks.push(t);
    } catch (err) { console.warn(err); }
    if (tracks.length % 5 === 0) { render(); }
  }
  tracks.sort((a, b) => a.title.localeCompare(b.title));
  tracks.forEach((t, i) => (t.id = i));
  render();
  toast(`${tracks.length} track${tracks.length === 1 ? "" : "s"} from ${label}`);
}
async function openFolder(path) {
  try {
    const list = []; await walk(path, list);
    if (!list.length) { toast("No MIDI or RMI files in that folder"); return; }
    S.lastFolder = path; save();
    toast(`Loading ${list.length} files...`);
    await loadEntries(list, path || "storage");
  } catch (e) {
    toast("Can't read storage. Allow 'All files access' for Midify in Android settings.");
    console.warn(e);
  }
}
function openFiles() {
  const inp = $("#filePick"); inp.value = "";
  inp.onchange = async () => {
    const fs = [...inp.files].filter((f) => EXT.test(f.name));
    if (!fs.length) return toast("No MIDI or RMI files selected");
    await loadEntries(fs.map((f) => ({ name: f.name, src: { file: f } })), "selection");
  };
  inp.click();
}

/* ---------- queue / transport ---------- */
function shuffled(arr, first) {
  const a = arr.filter((i) => i !== first);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return first == null ? a : [first, ...a];
}
function buildOrder(first) {
  const ids = tracks.map((t) => t.id);
  order = S.shuffle ? shuffled(ids, first) : ids;
  pos = first == null ? -1 : order.indexOf(first);
}
async function playTrack(id, rebuild = true) {
  const t = tracks[id]; if (!t) return;
  if (rebuild) buildOrder(id);
  const my = ++token;
  cur = t; playing = false; updateUI();
  try {
    await engine();
    const midi = BasicMIDI.fromArrayBuffer(await readBytes(t.src), t.name);
    if (my !== token) return;
    if (S.override && sfLoaded) midi.embeddedSoundBank = undefined;
    else if (!midi.embeddedSoundBank && !sfLoaded) toast("No soundfont. Choose one in Settings.");
    seq.skipToFirstNoteOn = S.skip;
    seq.loadNewSongList([midi]);
    seq.currentTime = 0;
    seq.play(); playing = true;
  } catch (e) { console.error(e); toast("Couldn't play " + t.title); }
  setMediaSession(); updateUI();
}
function next(auto) {
  if (!order.length) return;
  let p = pos + 1;
  if (p >= order.length) {
    if (S.repeat === "off" && auto) { playing = false; seq?.pause(); updateUI(); return; }
    if (S.shuffle) order = shuffled(order, null);
    p = 0;
  }
  pos = p; playTrack(order[pos], false);
}
function prev() {
  if (seq && seq.currentTime > 3) { seq.currentTime = 0; return; }
  if (!order.length) return;
  pos = pos > 0 ? pos - 1 : order.length - 1; playTrack(order[pos], false);
}
function toggle() {
  if (!cur) return;
  if (playing) { seq.pause(); playing = false; } else { engine().then(() => { seq.play(); playing = true; updateUI(); }); }
  updateUI();
}
function setShuffle(v) {
  S.shuffle = v; save();
  if (cur) buildOrder(cur.id); updateUI(); if (tab === "library") render();
}
function shuffleAll() {
  if (!tracks.length) return toast("Open a folder first");
  S.shuffle = true; save(); playTrack(tracks[Math.floor(Math.random() * tracks.length)].id);
}
function cycleRepeat() { S.repeat = { off: "all", all: "one", one: "off" }[S.repeat]; save(); updateUI(); }
function setMediaSession() {
  if (!("mediaSession" in navigator) || !cur) return;
  navigator.mediaSession.metadata = new MediaMetadata({ title: cur.title, artist: cur.artist, album: cur.album, artwork: cur.art ? [{ src: cur.art }] : [] });
  const h = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
  h("play", toggle); h("pause", toggle); h("nexttrack", () => next(false)); h("previoustrack", prev);
}

/* ---------- views ---------- */
const artHTML = (t, cls = "") => {
  if (t?.art) return `<div class="art ${cls}" style="background-image:url('${t.art}')"></div>`;
  const h = t ? hue(t.title) : 0;
  return `<div class="art ${cls}" style="background:linear-gradient(135deg,hsl(${h} 45% 35%),hsl(${(h + 40) % 360} 45% 18%))">${I.note}</div>`;
};
const rowHTML = (t) => `<button class="row ${cur?.id === t.id ? "cur" : ""}" data-id="${t.id}">${artHTML(t)}<div class="meta"><div class="t">${esc(t.title)}</div><div class="a">${t.rmi ? '<span class="badge">RMI</span>' : ""}${esc(t.artist)}${t.dur ? " · " + fmt(t.dur) : ""}</div></div></button>`;
const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };
const emptyHTML = `<div class="empty">Your library is empty.<br>Open a folder of MIDI / RMI files to make a playlist.<div class="actions" style="justify-content:center;margin-top:16px"><button class="pill" data-act="folder">Open folder</button><button class="pill" data-act="files">Pick files</button></div></div>`;

function render() {
  const v = $("#view"); const keep = v.scrollTop;
  if (tab === "home") {
    const tiles = tracks.slice(0, 6).map((t) => `<button class="tile" data-id="${t.id}">${artHTML(t)}<span>${esc(t.title)}</span></button>`).join("");
    v.innerHTML = `<div class="top"><h1>${greeting()}</h1><button class="icon" data-act="settings" aria-label="Settings">${I.gear}</button></div>
      ${tracks.length ? `<div class="grid">${tiles}</div><h2>Your tracks</h2>${tracks.map(rowHTML).join("")}` : emptyHTML}`;
  } else if (tab === "search") {
    v.innerHTML = `<h1>Search</h1><div class="search"><svg viewBox="0 0 24 24"><path d="M10 3a7 7 0 1 0 4.2 12.6l5.6 5.6 1.400-1.400-5.600-5.600A7 7 0 0 0 10 3zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"/></svg><input id="q" placeholder="What do you want to play?" value="${esc(query)}"></div><div id="results"></div>`;
    const q = $("#q"); q.oninput = () => { query = q.value; results(); }; results();
  } else {
    v.innerHTML = `<div class="top"><h1>Your Library</h1><div><button class="icon" data-act="folder" aria-label="Open folder">${I.folder}</button></div></div>
      <div class="chips"><span class="chip on">${S.lastFolder ? esc(S.lastFolder.split("/").pop() || "Storage") : "Tracks"}</span><button class="chip" data-act="files">Pick files</button></div>
      ${tracks.length ? `<div class="actions"><button class="sh ${S.shuffle ? "on" : ""}" data-act="shuf">${I.shuffle}</button><span style="flex:1;color:var(--mut);font-size:13px">${tracks.length} tracks</span><button class="play-big" data-act="playall">${I.play}</button></div>${tracks.map(rowHTML).join("")}` : emptyHTML}`;
  }
  v.scrollTop = keep;
}
function results() {
  const q = query.trim().toLowerCase();
  const r = q ? tracks.filter((t) => (t.title + " " + t.artist + " " + t.album).toLowerCase().includes(q)) : [];
  $("#results").innerHTML = q ? (r.length ? r.map(rowHTML).join("") : `<div class="empty">No results for "${esc(query)}"</div>`) : `<div class="empty">Search your tracks by title, artist or album.</div>`;
}

function updateUI() {
  $("#mini").classList.toggle("hidden", !cur);
  if (cur) {
    $("#miniArt").outerHTML = artHTML(cur, "sm").replace('class="art sm"', 'id="miniArt" class="art sm"');
    $("#miniTitle").textContent = cur.title; $("#miniArtist").textContent = cur.artist;
    $("#miniPlay").innerHTML = playing ? I.pause : I.play;
    $("#mini").style.background = `hsl(${hue(cur.title)} 30% 25%)`;
  }
  if (!$("#player").classList.contains("hidden")) renderPlayer();
  document.querySelectorAll(".row").forEach((r) => r.classList.toggle("cur", cur && +r.dataset.id === cur.id));
}
function renderPlayer() {
  const p = $("#player"); if (!cur) return;
  p.style.setProperty("--pc", `hsl(${hue(cur.title)} 40% 30%)`);
  const sh = p.querySelector(".seek input"); const old = sh ? sh.value : 0;
  p.innerHTML = `<div class="ptop"><button data-act="closeplayer">${I.down}</button><div>${esc(cur.album || "Playing from library")}</div><span style="width:40px"></span></div>
    <div class="pfig">${artHTML(cur)}</div>
    <div class="pinfo"><div class="t">${esc(cur.title)}</div><div class="a">${cur.rmi ? "RMI · " : ""}${esc(cur.artist)}</div></div>
    <div class="seek"><input type="range" id="seekbar" min="0" max="1000" value="${old}"><div class="times"><span id="tc">0:00</span><span>${fmt(cur.dur)}</span></div></div>
    <div class="ctrl"><button data-act="shuf" class="${S.shuffle ? "on" : ""}">${I.shuffle}</button><button data-act="prev">${I.prev}</button><button class="main" data-act="toggle">${playing ? I.pause : I.play}</button><button data-act="next">${I.next}</button><button data-act="rep" class="${S.repeat !== "off" ? "on" : ""}">${I.repeat}${S.repeat === "one" ? '<span style="position:absolute;font-size:9px;font-weight:800">1</span>' : ""}</button></div>`;
  const sb = $("#seekbar"); sb.oninput = () => { dragging = true; sb.style.setProperty("--p", sb.value / 10 + "%"); };
  sb.onchange = () => { if (seq && cur.dur) seq.currentTime = (sb.value / 1000) * cur.dur; dragging = false; };
}
let dragging = false;
setInterval(() => {
  if (!cur || !seq) return;
  const t = seq.currentTime, d = cur.dur || seq.duration || 1;
  $("#miniFill").style.width = (t / d) * 100 + "%";
  const sb = $("#seekbar");
  if (sb && !dragging) { sb.value = (t / d) * 1000; sb.style.setProperty("--p", (t / d) * 100 + "%"); $("#tc").textContent = fmt(t); }
}, 250);

/* ---------- settings ---------- */
function renderSettings() {
  const s = $("#settings");
  const sw = (id, on) => `<span class="sw ${on ? "on" : ""}" data-sw="${id}"></span>`;
  s.innerHTML = `<div class="sethead"><button data-act="closesettings">${I.back}</button><h1>Settings</h1></div>
    <div class="group">Playback</div>
    <button class="set" data-act="t-shuffle"><div>Shuffle<div class="d">Play library in random order</div></div>${sw("", S.shuffle)}</button>
    <button class="set" data-act="t-skip"><div>Skip silence at start<div class="d">Jump to the first note</div></div>${sw("", S.skip)}</button>
    <div class="set"><div style="flex:1">Volume<div class="d">Master output level</div><input type="range" id="vol" min="0" max="150" value="${Math.round(S.volume * 100)}" style="--p:${Math.round(S.volume * 66)}%"></div></div>
    <div class="group">Soundfont</div>
    <button class="set" data-act="t-override"><div>Override RMI soundfont<div class="d">Ignore the soundfont built into RMI files and use your own</div></div>${sw("", S.override)}</button>
    <button class="set" data-act="pick-sf"><div>${S.sfName ? "Change soundfont" : "Choose soundfont"}<div class="d">${S.sfName ? esc(S.sfName) : "SF2, SF3 or DLS. Used for plain MIDI and for overrides"}</div></div></button>
    ${S.sfName ? `<button class="set" data-act="clear-sf"><div>Remove soundfont</div></button>` : ""}
    <div class="group">Library</div>
    <button class="set" data-act="folder"><div>Open folder as playlist<div class="d">${S.lastFolder ? esc(S.lastFolder) : "Browse device storage"}</div></div></button>
    ${S.lastFolder ? `<button class="set" data-act="rescan"><div>Rescan last folder</div></button>` : ""}
    <button class="set" data-act="files"><div>Pick individual files</div></button>
    <div class="group">About</div><div class="set"><div>Midify 1.0<div class="d">MIDI and RMI player. Synthesis by SpessaSynth.</div></div></div>`;
  const v = $("#vol"); v.oninput = () => { S.volume = v.value / 100; v.style.setProperty("--p", v.value / 1.5 + "%"); if (gain) gain.gain.value = S.volume; save(); };
}

/* ---------- folder browser ---------- */
async function browse(path) {
  const b = $("#browser"); b.classList.remove("hidden");
  let dirs = [], err = "";
  try {
    const r = await Filesystem.readdir({ path, directory: Directory.ExternalStorage });
    dirs = r.files.filter((f) => f.type === "directory" && !f.name.startsWith(".")).sort((a, c) => a.name.localeCompare(c.name));
    var midi = r.files.filter((f) => EXT.test(f.name)).length;
  } catch (e) { err = "Cannot read this location. In Android Settings > Apps > Midify > Permissions, allow 'All files access' (or use 'Pick files')."; }
  const up = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  b.innerHTML = `<div class="sethead"><button data-act="closebrowser">${I.back}</button><h1>Choose folder</h1></div>
    <div class="crumb">/${esc(path)}</div>${err ? `<div class="empty">${err}</div>` : ""}
    ${path ? `<button class="fold" data-go="${esc(up)}">${I.folder}<span>..</span></button>` : ""}
    ${dirs.map((d) => `<button class="fold" data-go="${esc(path ? path + "/" + d.name : d.name)}">${I.folder}<span>${esc(d.name)}</span></button>`).join("")}
    <div class="bar"><button class="pill" data-act="files">Pick files</button><button class="pill go" data-use="${esc(path)}">Use this folder${midi ? ` (${midi})` : ""}</button></div>`;
}

/* ---------- events ---------- */
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-id],[data-act],[data-go],[data-use],#tabs button,#miniOpen,#miniPlay");
  if (!el) return;
  if (el.dataset.id != null) { await playTrack(+el.dataset.id); return; }
  if (el.dataset.go != null) return browse(el.dataset.go);
  if (el.dataset.use != null) { $("#browser").classList.add("hidden"); $("#settings").classList.add("hidden"); tab = "library"; syncTabs(); return openFolder(el.dataset.use); }
  if (el.id === "miniPlay") return toggle();
  if (el.id === "miniOpen") { $("#player").classList.remove("hidden"); return renderPlayer(); }
  if (el.dataset.tab) { tab = el.dataset.tab; syncTabs(); return render(); }
  switch (el.dataset.act) {
    case "settings": renderSettings(); $("#settings").classList.remove("hidden"); break;
    case "closesettings": $("#settings").classList.add("hidden"); break;
    case "closeplayer": $("#player").classList.add("hidden"); break;
    case "closebrowser": $("#browser").classList.add("hidden"); break;
    case "folder": browse(""); break;
    case "files": $("#browser").classList.add("hidden"); openFiles(); break;
    case "rescan": $("#settings").classList.add("hidden"); openFolder(S.lastFolder); break;
    case "shuf": setShuffle(!S.shuffle); break;
    case "t-shuffle": setShuffle(!S.shuffle); renderSettings(); break;
    case "t-skip": S.skip = !S.skip; save(); if (seq) seq.skipToFirstNoteOn = S.skip; renderSettings(); break;
    case "t-override": S.override = !S.override; save(); renderSettings(); toast(S.override ? "Takes effect on the next track" : "Using built-in RMI soundfonts"); break;
    case "pick-sf": {
      const inp = $("#sfPick"); inp.value = "";
      inp.onchange = async () => { const f = inp.files[0]; if (!f) return; toast("Loading soundfont..."); try { await setSoundfont(await f.arrayBuffer(), f.name); toast("Soundfont ready"); } catch { toast("Couldn't load that soundfont"); } renderSettings(); };
      inp.click(); break;
    }
    case "clear-sf": await clearSoundfont(); renderSettings(); break;
    case "playall": if (S.shuffle) shuffleAll(); else playTrack(0); break;
    case "prev": prev(); break;
    case "next": next(false); break;
    case "toggle": toggle(); break;
    case "rep": cycleRepeat(); break;
  }
});
function syncTabs() { document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab)); }

render();
if (S.lastFolder) openFolder(S.lastFolder);
