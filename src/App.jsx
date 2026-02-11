import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabase";


const USERS_KEY = "vibe_users_v1"; // registered users
const SESSION_KEY = "vibe_session_v1"; // current logged-in username

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function genUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC4122-ish fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function parseJsonSafely(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function normalizeUsername(u) {
  return String(u || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function usernameToAuthEmail(usernameRaw) {
  const username = normalizeUsername(usernameRaw);
  const localPart = username.replace(/[^a-z0-9._-]/g, "");
  return localPart ? `${localPart}@vibe-user.example.com` : "";
}

function mapDbItem(row, actorMap = {}) {
  const createdByRaw = String(row.created_by ?? "?");
  const updatedByRaw = String(row.updated_by ?? row.created_by ?? "?");
  return {
    id: row.id,
    name: row.item_name ?? "",
    tag: row.tag ?? "",
    location: row.location ?? "",
    qty: row.qty ?? 1,
    checked: !!row.checked,
    note: row.notes ?? "",
    createdBy: actorMap[createdByRaw] || createdByRaw,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedBy: actorMap[updatedByRaw] || updatedByRaw,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
  };
}

async function loadProfileMapForActorIds(actorIds) {
  if (!actorIds.length) return {};
  const { data, error } = await supabase
    .from("user_profiles")
    .select("user_id,email")
    .in("user_id", actorIds);
  if (error || !Array.isArray(data)) return {};

  const out = {};
  for (const row of data) {
    const id = String(row.user_id || "");
    if (!id) continue;
    out[id] = String(row.email || id);
  }
  return out;
}

async function upsertCurrentUserProfile(user) {
  if (!user?.id) return;
  await supabase.from("user_profiles").upsert(
    {
      user_id: user.id,
      email: user.email || "",
    },
    { onConflict: "user_id" }
  );
}

function fmtTime(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleString();
}

async function sha256(text) {
  const str = String(text ?? "");
  if (window.crypto?.subtle) {
    const enc = new TextEncoder().encode(str);
    const buf = await window.crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // fallback (not crypto-strong, but avoids breaking if subtle is unavailable)
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return `weak_${Math.abs(h)}`;
}

function loadUsers() {
  const raw = localStorage.getItem(USERS_KEY);
  const parsed = raw ? parseJsonSafely(raw) : null;
  return Array.isArray(parsed) ? parsed : [];
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function loadSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  const u = normalizeUsername(raw);
  return u || "";
}

function saveSession(username) {
  localStorage.setItem(SESSION_KEY, username || "");
}

function inventoryKeyFor() {
  return "vibe_inventory_shared_v1";
}


function seedItems(seedUser) {
  const now = Date.now();
  return [
    {
      id: uid(),
      name: "ATEM Constellation",
      tag: "VID-SW-001",
      location: "Rack A",
      qty: 1,
      checked: false,
      note: "HDMI preview monitor nearby",
      createdBy: seedUser || "seed",
      createdAt: now,
      updatedBy: seedUser || "seed",
      updatedAt: now,
    },
    {
      id: uid(),
      name: "Shure Handheld Mic",
      tag: "AUD-RF-014",
      location: "Drawer 2",
      qty: 2,
      checked: true,
      note: "Check batteries",
      createdBy: seedUser || "seed",
      createdAt: now,
      updatedBy: seedUser || "seed",
      updatedAt: now,
    },
    {
      id: uid(),
      name: "SDI Cable 10m",
      tag: "CAB-SDI-10M",
      location: "Cable wall",
      qty: 6,
      checked: false,
      note: "",
      createdBy: seedUser || "seed",
      createdAt: now,
      updatedBy: seedUser || "seed",
      updatedAt: now,
    },
  ];
}

function loadInventory() {
  const key = inventoryKeyFor();
  const raw = localStorage.getItem(key);
  const parsed = raw ? parseJsonSafely(raw) : null;
  if (Array.isArray(parsed)) return parsed;
  return seedItems("seed");
}

function saveInventory(items) {
  const key = inventoryKeyFor();
  localStorage.setItem(key, JSON.stringify(items));
}


export default function App() {
  const [currentUser, setCurrentUser] = useState("");
  const [authIdentity, setAuthIdentity] = useState({ id: "", email: "" });

  const [authToast, setAuthToast] = useState("");

  const [items, setItems] = useState(() => {
    const u = loadSession();
    return u ? loadInventory() : [];
  });

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all"); // all | checked | missing
  const [sort, setSort] = useState("recent"); // recent | name | location
  const [toast, setToast] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [addDebug, setAddDebug] = useState("");
  const fileRef = useRef(null);

  // load inventory when user changes
  useEffect(() => {
  if (!currentUser) return;
  loadInventoryFromDb();
}, [currentUser]);


  // persist inventory when items change

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!authToast) return;
    const t = setTimeout(() => setAuthToast(""), 1800);
    return () => clearTimeout(t);
  }, [authToast]);

  async function loadInventoryFromDb() {
  const { data, error } = await supabase
    .from("inventory_items")
    .select("id, created_at, item_name, tag, location, qty, checked, notes, created_by, updated_at, updated_by")
    .order("updated_at", { ascending: false });

  if (error) {
    setToast("Load error: " + error.message);
    return;
  }

  const rows = data || [];
  const actorIds = Array.from(
    new Set(
      rows
        .flatMap((r) => [r.created_by, r.updated_by])
        .filter(Boolean)
        .map((v) => String(v))
    )
  );
  const actorMap = await loadProfileMapForActorIds(actorIds);
  if (authIdentity?.id && authIdentity?.email) actorMap[authIdentity.id] = authIdentity.email;
  const mapped = rows.map((r) => mapDbItem(r, actorMap));

  setItems(mapped);
}


  const stats = useMemo(() => {
    const total = items.length;
    const checked = items.filter((i) => i.checked).length;
    const missing = total - checked;
    return { total, checked, missing };
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    let out = items.filter((i) => {
      if (!q) return true;
      const hay = `${i.name} ${i.tag} ${i.location} ${i.note}`.toLowerCase();
      return hay.includes(q);
    });

    if (filter === "checked") out = out.filter((i) => i.checked);
    if (filter === "missing") out = out.filter((i) => !i.checked);

    if (sort === "recent")
      out = [...out].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (sort === "name") out = [...out].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "location")
      out = [...out].sort((a, b) => (a.location || "").localeCompare(b.location || ""));

    return out;
  }, [items, query, filter, sort]);

  async function upsertItem(partial) {
  const id = partial.id;
  if (typeof id === "string" && id.startsWith("tmp_")) {
    setToast("Syncing item, please try again.");
    loadInventoryFromDb();
    return;
  }
  const patch = {};
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    setToast("Session expired. Please log in again.");
    return;
  }

  if ("name" in partial) patch.item_name = String(partial.name || "").trim();
  if ("tag" in partial) patch.tag = String(partial.tag || "").trim();
  if ("location" in partial) patch.location = String(partial.location || "").trim();
  if ("qty" in partial) patch.qty = Number(partial.qty || 1) || 1;
  if ("note" in partial) patch.notes = String(partial.note || "").trim();
  if ("checked" in partial) patch.checked = !!partial.checked;
  patch.updated_by = authData.user.id;

  const { error } = await supabase.from("inventory_items").update(patch).eq("id", id);
  if (error) {
    setToast("Update error: " + error.message);
    return;
  }

  setToast("Saved");
  loadInventoryFromDb();
}




  async function addItem(e) {
    e.preventDefault();
    const formEl = e.currentTarget;
    if (!(formEl instanceof HTMLFormElement)) {
      const msg = "Add form not found. Please reload.";
      setToast(msg);
      setAddError(msg);
      setAddDebug(msg);
      return;
    }
    if (isAdding) return;
    setIsAdding(true);
    setAddDebug("Submitting...");
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData?.user) {
        const msg = "Session expired. Please log in again.";
        setToast(msg);
        setAddError(msg);
        setAddDebug(msg);
        return;
      }

      const fd = new FormData(formEl);
      const item_name = String(fd.get("name") || "").trim();
      if (!item_name) {
        setAddDebug("Name is required.");
        return;
      }

      const tag = String(fd.get("tag") || "").trim();
      const location = String(fd.get("location") || "").trim();
      const qty = Number(fd.get("qty") || 1) || 1;
      const notes = String(fd.get("note") || "").trim();
      const now = Date.now();
      const itemId = genUuid();

      const optimisticItem = {
        id: itemId,
        name: item_name,
        tag,
        location,
        qty,
        checked: false,
        note: notes,
        createdBy: currentUser || authData.user.id,
        createdAt: now,
        updatedBy: currentUser || authData.user.id,
        updatedAt: now,
      };

      setItems((prev) => [optimisticItem, ...prev]);
      setAddDebug("Staged locally. Sending to Supabase...");

      const { error } = await supabase
        .from("inventory_items")
        .insert([{
          id: itemId,
          item_name,
          tag,
          location,
          qty,
          notes: notes || null,
          checked: false,
          created_by: authData.user.id,
          updated_by: authData.user.id,
        }], { returning: "minimal" });

      if (error) {
        setItems((prev) => prev.filter((x) => x.id !== itemId));
        const msg = "Insert error: " + error.message;
        setToast(msg);
        setAddError(msg);
        setAddDebug(msg);
        return;
      }

      formEl.reset();
      setQuery("");
      setFilter("all");
      setSort("recent");
      setAddError("");
      setAddDebug("Added.");
      setToast("Added");
    } catch (err) {
      const msg = `Unhandled add error: ${err instanceof Error ? err.message : String(err)}`;
      setToast(msg);
      setAddError(msg);
      setAddDebug(msg);
    } finally {
      setIsAdding(false);
    }
  }


  async function removeItem(id) {
  const { error } = await supabase.from("inventory_items").delete().eq("id", id);
  if (error) {
    setToast("Delete error: " + error.message);
    return;
  }
  setToast("Deleted");
  loadInventoryFromDb();
}


  async function setAllChecked(checkedValue) {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      setToast("Session expired. Please log in again.");
      return;
    }

    const { error } = await supabase
      .from("inventory_items")
      .update({ checked: checkedValue, updated_by: authData.user.id }, { count: "exact" })
      .not("id", "is", null);

    if (error) {
      setToast("Bulk update error: " + error.message);
      return;
    }

    // If zero rows were touched, RLS/policies likely block this user from updating shared rows.
    const { count } = await supabase
      .from("inventory_items")
      .select("id", { count: "exact", head: true });
    if (count && count > 0) {
      const { count: changedCount } = await supabase
        .from("inventory_items")
        .select("id", { count: "exact", head: true })
        .eq("checked", checkedValue);
      if (!changedCount || changedCount === 0) {
        setToast("Policy blocks shared updates. Update RLS in Supabase.");
        return;
      }
    }

    setItems((prev) =>
      prev.map((x) => ({
        ...x,
        checked: checkedValue,
        updatedAt: Date.now(),
        updatedBy: currentUser || authData.user.id,
      }))
    );
    setToast(checkedValue ? "All checked" : "Reset");
    loadInventoryFromDb();
  }

  function resetChecks() {
    return setAllChecked(false);
  }

  function markAllChecked() {
    return setAllChecked(true);
  }

  function exportJson() {
    downloadText(
      `inventory-${currentUser}-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(items, null, 2)
    );
    setToast("Exported");
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseJsonSafely(String(reader.result || ""));
      if (!Array.isArray(parsed)) {
        setToast("Import failed");
        return;
      }

      const cleaned = parsed
        .filter((x) => x && typeof x === "object")
        .map((x) => ({
          id: String(x.id || uid()),
          name: String(x.name || "Untitled"),
          tag: String(x.tag || ""),
          location: String(x.location || ""),
          qty: Number(x.qty || 1) || 1,
          checked: Boolean(x.checked),
          note: String(x.note || ""),

          createdBy: String(x.createdBy || currentUser),
          createdAt: Number(x.createdAt || Date.now()),
          updatedBy: String(x.updatedBy || currentUser),
          updatedAt: Number(x.updatedAt || Date.now()),
        }));

      setItems(cleaned);
      setToast("Imported");
    };
    reader.readAsText(file);
  }

  async function onSignup(usernameRaw, password) {
    const username = normalizeUsername(usernameRaw);
    if (!username || !password) {
      setAuthToast("Enter username + password");
      return;
    }

    const email = usernameToAuthEmail(usernameRaw);
    if (!email) {
      setAuthToast("Invalid username format");
      return;
    }
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } },
    });

    if (error) {
      setAuthToast(error.message);
      return;
    }

    setAuthToast("Signed up. Now log in.");
  }

  async function onLogin(usernameRaw, password) {
    const username = normalizeUsername(usernameRaw);
    if (!username || !password) {
      setAuthToast("Enter username + password");
      return;
    }

    const email = usernameToAuthEmail(usernameRaw);
    if (!email) {
      setAuthToast("Invalid username format");
      return;
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthToast(error.message);
      return;
    }

    const u =
      data?.user?.user_metadata?.username ||
      data?.user?.email?.split("@")?.[0] ||
      username;
    setCurrentUser(u);
    setAuthIdentity({
      id: data?.user?.id || "",
      email: data?.user?.email || "",
    });
    await upsertCurrentUserProfile(data?.user);
    setAuthToast("Logged in");
  }

  async function onLogout() {
    await supabase.auth.signOut();
    setCurrentUser("");
    setAuthIdentity({ id: "", email: "" });
    setItems([]);
    setQuery("");
    setFilter("all");
    setSort("recent");
    setToast("");
    setAuthToast("Logged out");
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const s = data.session;
      if (!s?.user) return;

      const u = s.user.user_metadata?.username || s.user.email?.split("@")?.[0] || "";
      setCurrentUser(u);
      setAuthIdentity({
        id: s.user.id || "",
        email: s.user.email || "",
      });
      upsertCurrentUserProfile(s.user);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user?.user_metadata?.username || session?.user?.email?.split("@")?.[0] || "";
      setCurrentUser(u);
      setAuthIdentity({
        id: session?.user?.id || "",
        email: session?.user?.email || "",
      });
      upsertCurrentUserProfile(session?.user);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  if (!currentUser) {
    return <AuthScreen toast={authToast} onSignup={onSignup} onLogin={onLogin} />;
  }

  return (
    <div style={styles.page}>
      <div style={{ ...styles.blob, ...styles.blobA }} />
      <div style={{ ...styles.blob, ...styles.blobB }} />
      <div style={{ ...styles.blob, ...styles.blobC }} />
      

      <div style={styles.container}>
        <header style={styles.header}>
          <div>
            <div style={styles.kicker}>Inventory Check</div>
            <h1 style={styles.h1}>Vibe Stocktake</h1>
            <div style={styles.sub}>
              Logged in as <b>{currentUser}</b>
              <button onClick={onLogout} style={{ ...styles.btnMini, marginLeft: 10 }}>
                Logout
              </button>
            </div>
          </div>

          <div style={styles.statsRow}>
            <Stat label="Total" value={stats.total} />
            <Stat label="Checked" value={stats.checked} />
            <Stat label="Missing" value={stats.missing} />
          </div>
        </header>

        <div style={styles.grid}>
          <section style={styles.card}>
            <div style={styles.cardTitle}>Add item</div>
            <form onSubmit={addItem} style={styles.form}>
              <Input name="name" placeholder="Item name (required)" required />
              <div style={styles.row2}>
                <Input name="tag" placeholder="Tag (e.g. AUD-RF-014)" />
                <Input name="location" placeholder="Location" />
              </div>
              <div style={styles.row2}>
                <Input name="qty" type="number" placeholder="Qty" defaultValue={1} min={1} />
                <Input name="note" placeholder="Note" />
              </div>

              <button type="submit" disabled={isAdding} style={{ ...styles.btn, ...styles.btnPrimary, opacity: isAdding ? 0.7 : 1 }}>
                {isAdding ? "Adding..." : "+ Add"}
              </button>
              {addError ? <div style={{ fontSize: 12, color: "#ff9db8" }}>{addError}</div> : null}
              {addDebug ? <div style={{ fontSize: 12, opacity: 0.85 }}>{addDebug}</div> : null}
            </form>

            <div style={styles.divider} />

            <div style={styles.cardTitle}>Stocktake controls</div>
            <div style={styles.controls}>
              <button onClick={markAllChecked} style={styles.btn}>
                Mark all checked
              </button>
              <button onClick={resetChecks} style={styles.btn}>
                Reset checks
              </button>
              <button onClick={exportJson} style={styles.btn}>
                Export JSON
              </button>

              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importJson(f);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                style={{ ...styles.btn, ...styles.btnGhost }}
              >
                Import JSON
              </button>
            </div>

           
          </section>

          <section style={{ ...styles.card, ...styles.cardTall }}>
            <div style={styles.listTop}>
              <div style={styles.cardTitle}>Items</div>

              <div style={styles.listControls}>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, tag, location…"
                  style={styles.search}
                />

                <select value={filter} onChange={(e) => setFilter(e.target.value)} style={styles.select}>
                  <option value="all">All</option>
                  <option value="checked">Checked</option>
                  <option value="missing">Missing</option>
                </select>

                <select value={sort} onChange={(e) => setSort(e.target.value)} style={styles.select}>
                  <option value="recent">Recent</option>
                  <option value="name">Name</option>
                  <option value="location">Location</option>
                </select>
              </div>
            </div>

            <div style={styles.list}>
              {filtered.length === 0 ? (
                <div style={styles.empty}>No items match.</div>
              ) : (
                filtered.map((it) => (
                  <ItemRow
                    key={it.id}
                    item={it}
                    onToggle={() => upsertItem({ id: it.id, checked: !it.checked })}
                    onEdit={(patch) => upsertItem({ id: it.id, ...patch })}
                    onDelete={() => removeItem(it.id)}
                  />
                ))
              )}
            </div>
          </section>
        </div>

        {toast ? <div style={styles.toast}>{toast}</div> : null}
        <footer style={styles.footer}>Next vibes: barcode scan, audit log, multi-device sync.</footer>
      </div>
    </div>
  );
}


function AuthScreen({ toast, onSignup, onLogin }) {
  const [mode, setMode] = useState("login"); // login | signup
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div style={styles.page}>
      <div style={{ ...styles.blob, ...styles.blobA }} />
      <div style={{ ...styles.blob, ...styles.blobB }} />
      <div style={{ ...styles.blob, ...styles.blobC }} />

      <div style={styles.container}>
        <header style={styles.header}>
          <div>
            <div style={styles.kicker}>Inventory Check</div>
            <h1 style={styles.h1}>Vibe Stocktake</h1>
            <div style={styles.sub}>Login is stored in Supabase Database.</div>
          </div>
        </header>

        <section style={{ ...styles.card, maxWidth: 520 }}>
          <div style={styles.cardTitle}>{mode === "login" ? "Login" : "Sign up"}</div>

          <div style={styles.form}>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username (no spaces)"
              style={styles.input}
            />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              type="password"
              style={styles.input}
            />

            {mode === "login" ? (
              <button onClick={() => onLogin(username, password)} style={{ ...styles.btn, ...styles.btnPrimary }}>
                Login
              </button>
            ) : (
              <button onClick={() => onSignup(username, password)} style={{ ...styles.btn, ...styles.btnPrimary }}>
                Create account
              </button>
            )}

            <button
              onClick={() => setMode((m) => (m === "login" ? "signup" : "login"))}
              style={{ ...styles.btn, ...styles.btnGhost }}
            >
              Switch to {mode === "login" ? "Sign up" : "Login"}
            </button>

            {toast ? <div style={{ marginTop: 10, opacity: 0.9 }}>{toast}</div> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={styles.stat}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>
    </div>
  );
}

function Input(props) {
  return <input {...props} style={styles.input} />;
}

function ItemRow({ item, onToggle, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: item.name,
    tag: item.tag,
    location: item.location,
    qty: item.qty,
    note: item.note,
  });

  useEffect(() => {
    setDraft({
      name: item.name,
      tag: item.tag,
      location: item.location,
      qty: item.qty,
      note: item.note,
    });
  }, [item.id]);

  const pill = item.checked ? styles.pillOk : styles.pillWarn;

  return (
    <div style={styles.itemRow}>
      <button onClick={onToggle} style={{ ...styles.check, ...(item.checked ? styles.checkOn : {}) }}>
        {item.checked ? "✓" : ""}
      </button>

      <div style={styles.itemMain}>
        <div style={styles.itemTop}>
          {editing ? (
            <input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              style={{ ...styles.inlineInput, width: "100%" }}
            />
          ) : (
            <div style={styles.itemName}>{item.name}</div>
          )}
          <div style={{ ...styles.pill, ...pill }}>{item.checked ? "Checked" : "Missing"}</div>
        </div>

        <div style={styles.meta}>
          {editing ? (
            <>
              <input
                value={draft.tag}
                onChange={(e) => setDraft((d) => ({ ...d, tag: e.target.value }))}
                placeholder="Tag"
                style={styles.inlineInput}
              />
              <input
                value={draft.location}
                onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))}
                placeholder="Location"
                style={styles.inlineInput}
              />
              <input
                value={draft.qty}
                onChange={(e) => setDraft((d) => ({ ...d, qty: e.target.value }))}
                placeholder="Qty"
                type="number"
                min={1}
                style={{ ...styles.inlineInput, width: 80 }}
              />
              <input
                value={draft.note}
                onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                placeholder="Note"
                style={{ ...styles.inlineInput, width: "100%" }}
              />
            </>
          ) : (
            <>
              <span style={styles.badge}>{item.tag || "No tag"}</span>
              <span style={styles.badge}>{item.location || "No location"}</span>
              <span style={styles.badge}>Qty {item.qty}</span>
              {item.note ? <span style={styles.badgeSoft}>{item.note}</span> : null}

              <span style={styles.badgeSoft}>
                Added by {item.createdBy || "?"} · {fmtTime(item.createdAt)}
              </span>
              <span style={styles.badgeSoft}>
                Last by {item.updatedBy || "?"} · {fmtTime(item.updatedAt)}
              </span>
            </>
          )}
        </div>
      </div>

      <div style={styles.actions}>
        {!editing ? (
          <button onClick={() => setEditing(true)} style={{ ...styles.btnMini, ...styles.btnMiniGhost }}>
            Edit
          </button>
        ) : (
          <>
            <button
              onClick={() => {
                onEdit({
                  name: String(draft.name || "").trim() || "Untitled",
                  tag: String(draft.tag || "").trim(),
                  location: String(draft.location || "").trim(),
                  qty: Number(draft.qty || 1) || 1,
                  note: String(draft.note || "").trim(),
                });
                setEditing(false);
              }}
              style={{ ...styles.btnMini, ...styles.btnMiniPrimary }}
            >
              Save
            </button>
            <button onClick={() => setEditing(false)} style={{ ...styles.btnMini, ...styles.btnMiniGhost }}>
              Cancel
            </button>
          </>
        )}

        <button onClick={onDelete} style={{ ...styles.btnMini, ...styles.btnMiniDanger }}>
          Delete
        </button>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    color: "rgba(255,255,255,0.92)",
    background:
      "radial-gradient(1200px 800px at 20% 20%, rgba(226, 245, 11, 0.35), transparent 60%), radial-gradient(900px 700px at 80% 40%, rgba(255, 140, 0, 0.22), transparent 60%), radial-gradient(800px 600px at 40% 90%, rgba(255,80,170,0.18), transparent 60%), linear-gradient(180deg, #0b0f1a 0%, #070913 100%)",
    position: "relative",
    overflow: "hidden",
    overflowX: "hidden",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"',
  },

  blob: { position: "absolute", filter: "blur(28px)", opacity: 0.55, borderRadius: "999px" },
  blobA: {
    width: 520,
    height: 520,
    left: -180,
    top: -160,
    background: "radial-gradient(circle at 30% 30%, rgba(120,119,198,1), rgba(120,119,198,0) 62%)",
  },
  blobB: {
    width: 460,
    height: 460,
    right: -160,
    top: 120,
    background: "radial-gradient(circle at 30% 30%, rgb(255, 0, 0), rgba(0,205,255,0) 62%)",
  },
  blobC: {
    width: 560,
    height: 560,
    left: 260,
    bottom: -280,
    background: "radial-gradient(circle at 30% 30%, rgb(255, 182, 80), rgba(255,80,170,0) 62%)",
  },

  container: {
  maxWidth: "1400px",
  margin: "0 auto",
  padding: "clamp(16px, 3vw, 40px)",
},
  header: {
    display: "flex",
    gap: 18,
    alignItems: "flex-end",
    justifyContent: "space-between",
    flexWrap: "wrap",
    marginBottom: 18,
  },
  kicker: { fontSize: 12, letterSpacing: 1.4, textTransform: "uppercase", opacity: 0.8 },
  h1: {
  fontSize: "clamp(22px, 4vw, 36px)",
  margin: "6px 0 6px",
  lineHeight: 1.1,
},
  sub: { opacity: 0.82, maxWidth: 520 },

  statsRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  stat: {
    padding: "10px 12px",
    borderRadius: 16,
    background: "rgba(255,255,255,0.07)",
    border: "1px solid rgba(255,255,255,0.10)",
    backdropFilter: "blur(10px)",
    minWidth: 110,
  },
  statLabel: { fontSize: 12, opacity: 0.75 },
  statValue: { fontSize: 20, fontWeight: 700 },

  grid: {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: "clamp(12px, 2vw, 20px)",
},
  card: {
    borderRadius: 22,
    background: "rgba(255,255,255,0.07)",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 16px 40px rgba(0,0,0,0.35)",
    backdropFilter: "blur(12px)",
    padding: 16,
  },
  cardTall: {
  minHeight: "min(540px, 80vh)",
},

  cardTitle: { fontSize: 14, letterSpacing: 0.3, opacity: 0.85, marginBottom: 10 },

  form: { display: "flex", flexDirection: "column", gap: 10 },
  row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  input: {
    padding: "12px 12px",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.20)",
    color: "rgba(255,255,255,0.92)",
    outline: "none",
  },

  btn: {
    padding: "11px 12px",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.08)",
    color: "rgba(255,255,255,0.92)",
    cursor: "pointer",
    fontWeight: 650,
  },
  btnPrimary: {
    border: "1px solid rgba(0,205,255,0.28)",
    background: "linear-gradient(90deg, rgba(0,205,255,0.20), rgba(120,119,198,0.20))",
  },
  btnGhost: { background: "rgba(0,0,0,0.18)" },

  divider: { height: 1, background: "rgba(255,255,255,0.10)", margin: "14px 0" },
  controls: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  tip: { marginTop: 12, fontSize: 12.5, opacity: 0.8, lineHeight: 1.35 },

  listTop: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 10,
  },
  listControls: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" },
  search: {
    padding: "11px 12px",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.20)",
    color: "rgba(255,255,255,0.92)",
    outline: "none",
    minWidth: 240,
  },
  select: {
    padding: "10px 10px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.20)",
    color: "rgba(255,255,255,0.92)",
    outline: "none",
  },

  list: { display: "flex", flexDirection: "column", gap: 10, marginTop: 8 },
  empty: { padding: 16, opacity: 0.75 },

  itemRow: {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    padding: 12,
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.18)",
  },
  check: {
    width: 34,
    height: 34,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.95)",
    cursor: "pointer",
    fontWeight: 900,
    display: "grid",
    placeItems: "center",
    flex: "0 0 auto",
  },
  checkOn: {
    border: "1px solid rgba(0,205,255,0.30)",
    background: "linear-gradient(180deg, rgba(0,205,255,0.20), rgba(120,119,198,0.18))",
  },

  itemMain: { flex: "1 1 auto", minWidth: 0 },
  itemTop: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" },
  itemName: {
    fontSize: 15.5,
    fontWeight: 760,
    lineHeight: 1.2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  pill: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    whiteSpace: "nowrap",
  },
  pillOk: { border: "1px solid rgba(0,205,255,0.28)" },
  pillWarn: { border: "1px solid rgba(255,80,170,0.22)", opacity: 0.9 },

  meta: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, opacity: 0.92 },
  badge: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.06)",
  },
  badgeSoft: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(120,119,198,0.18)",
    background: "rgba(120,119,198,0.10)",
  },

  actions: { display: "flex", flexDirection: "column", gap: 8, flex: "0 0 auto" },
  btnMini: {
    padding: "8px 10px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.08)",
    color: "rgba(255,255,255,0.92)",
    cursor: "pointer",
    fontWeight: 650,
    fontSize: 12.5,
  },
  btnMiniPrimary: {
    border: "1px solid rgba(0,205,255,0.28)",
    background: "linear-gradient(90deg, rgba(0,205,255,0.18), rgba(120,119,198,0.16))",
  },
  btnMiniGhost: { background: "rgba(0,0,0,0.16)" },
  btnMiniDanger: {
    border: "1px solid rgba(255,80,170,0.22)",
    background: "rgba(255,80,170,0.08)",
  },

  inlineInput: {
    padding: "8px 10px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.20)",
    color: "rgba(255,255,255,0.92)",
    outline: "none",
    minWidth: 120,
  },

  toast: {
    position: "fixed",
    left: "50%",
    bottom: 22,
    transform: "translateX(-50%)",
    padding: "10px 14px",
    borderRadius: 999,
    background: "rgba(0,0,0,0.55)",
    border: "1px solid rgba(255,255,255,0.12)",
    backdropFilter: "blur(10px)",
    fontWeight: 700,
  },
  footer: { marginTop: 14, opacity: 0.65, fontSize: 12.5 },
};

// quick responsive tweak
