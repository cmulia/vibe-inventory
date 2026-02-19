import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabase";


const USERS_KEY = "vibe_users_v1"; // registered users
const SESSION_KEY = "vibe_session_v1"; // current logged-in username
const CONSUMABLES_KEY = "vibe_consumables_v1"; // legacy local key (migration fallback)
const THEME_KEY = "vibe_theme_v1";
const CONSUMABLE_LOCATIONS = ["Clancy", "Scientia", "Science Theatre"];
const ADMIN_USERNAMES = new Set(["admin"]);
const ADMIN_EMAILS = new Set(["admin@vibe-user.example.com"]);

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

function normalizeDisplayName(nameRaw) {
  return String(nameRaw || "").trim().replace(/\s+/g, " ");
}

function isAdminIdentity(user, usernameHint = "") {
  const username = normalizeUsername(user?.user_metadata?.username || usernameHint);
  const email = String(user?.email || "").toLowerCase();
  const role = String(user?.user_metadata?.role || "").toLowerCase();
  return role === "admin" || ADMIN_USERNAMES.has(username) || ADMIN_EMAILS.has(email);
}

function usernameToAuthEmail(usernameRaw) {
  const username = normalizeUsername(usernameRaw);
  const localPart = username.replace(/[^a-z0-9._-]/g, "");
  return localPart ? `${localPart}@vibe-user.example.com` : "";
}

function actorDisplayName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "?";
  if (raw.includes("@")) {
    const local = raw.split("@")[0] || "";
    const normalized = local.replace(/[._-]+/g, " ").trim();
    return normalized || local || raw;
  }
  return raw;
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
    createdBy: actorDisplayName(actorMap[createdByRaw] || createdByRaw),
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedBy: actorDisplayName(actorMap[updatedByRaw] || updatedByRaw),
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

async function upsertCurrentUserProfile(user, realEmail = "") {
  if (!user?.id) return;
  const email = realEmail || user?.user_metadata?.real_email || user?.email || "";
  await supabase.from("user_profiles").upsert(
    {
      user_id: user.id,
      email: user.email || "",
      real_email: email,
      email_verified: false,
    },
    { onConflict: "user_id" }
  );
}

function fmtTime(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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

function loadConsumables() {
  const raw = localStorage.getItem(CONSUMABLES_KEY);
  const parsed = raw ? parseJsonSafely(raw) : null;
  return Array.isArray(parsed) ? parsed : [];
}


export default function App() {
  const [currentUser, setCurrentUser] = useState("");
  const [currentName, setCurrentName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || "dark");
  const [activePage, setActivePage] = useState("consumables"); // overview | equipment | consumables | feedback
  const [authIdentity, setAuthIdentity] = useState({ id: "", email: "" });

  const [authToast, setAuthToast] = useState("");

  const [items, setItems] = useState(() => {
    const u = loadSession();
    return u ? loadInventory() : [];
  });
  const [consumables, setConsumables] = useState([]);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all"); // all | checked | missing
  const [sort, setSort] = useState("recent"); // recent | unsorted | name | location
  const [toast, setToast] = useState("");
  const [toastLeaving, setToastLeaving] = useState(false);
  const [feedbackRows, setFeedbackRows] = useState([]);
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [consumableJump, setConsumableJump] = useState(null);
  const [equipmentJump, setEquipmentJump] = useState(null);
  const [globalSearch, setGlobalSearch] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addError, setAddError] = useState("");
  const [addDebug, setAddDebug] = useState("");
  const fileRef = useRef(null);

  // load inventory when user changes
  useEffect(() => {
    if (!currentUser) return;
    loadInventoryFromDb();
    loadConsumablesFromDb();
    loadFeedbacksFromDb();
  }, [currentUser]);


  // persist inventory when items change

  useEffect(() => {
    if (!toast) return;
    setToastLeaving(false);
    const totalMs = 1800;
    const leaveAtMs = 1580;
    const tLeave = setTimeout(() => setToastLeaving(true), leaveAtMs);
    const tClear = setTimeout(() => {
      setToast("");
      setToastLeaving(false);
    }, totalMs);
    return () => {
      clearTimeout(tLeave);
      clearTimeout(tClear);
    };
  }, [toast]);

  useEffect(() => {
    if (!authToast) return;
    const isInvalidCred = /invalid login credentials/i.test(authToast);
    const t = setTimeout(() => setAuthToast(""), isInvalidCred ? 60000 : 1800);
    return () => clearTimeout(t);
  }, [authToast]);

  useEffect(() => {
    const next = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(THEME_KEY, next);
  }, [theme]);

  useEffect(() => {
    if (!isAdmin && activePage === "equipment") {
      setActivePage("consumables");
    }
  }, [isAdmin, activePage]);

  useEffect(() => {
    loadFeedbacksFromDb();
  }, [isAdmin, authIdentity.id, currentUser]);

  useEffect(() => {
    if (!currentUser) return;

    const channel = supabase
      .channel("inventory-consumables-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "consumables_items" },
        () => {
          loadConsumablesFromDb();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory_items" },
        () => {
          loadInventoryFromDb();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "feedback_entries" },
        () => {
          loadFeedbacksFromDb();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser, isAdmin]);

  async function loadInventoryFromDb() {
  const { data, error } = await supabase
    .from("inventory_items")
    .select("id, created_at, item_name, tag, location, qty, checked, notes, created_by, updated_at, updated_by")
    .order("created_at", { ascending: false });

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
  if (authIdentity?.id && authIdentity?.email) {
    actorMap[authIdentity.id] = actorDisplayName(authIdentity.email);
  }
  const mapped = rows.map((r) => mapDbItem(r, actorMap));

  setItems(mapped);
}

  async function loadConsumablesFromDb() {
    const { data, error } = await supabase
      .from("consumables_items")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      setToast("Consumables load error: " + error.message);
      return;
    }

    const rows = data || [];
    if (rows.length === 0) {
      const legacy = loadConsumables();
      if (legacy.length > 0) {
        const insertRows = legacy.map((x) => ({
          id: String(x.id || genUuid()),
          name: String(x.name || "Untitled"),
          category: String(x.category || ""),
          unit: String(x.unit || "pcs"),
          location: String(x.location || CONSUMABLE_LOCATIONS[0]),
          on_hand: Number(x.onHand || 0) || 0,
          min_level: Number(x.minLevel || 0) || 0,
          updated_by_name: currentName || currentUser || "Unknown",
          updated_by_username: currentUser || "unknown",
        }));
        const { error: insertError } = await supabase.from("consumables_items").insert(insertRows);
        if (!insertError) {
          localStorage.removeItem(CONSUMABLES_KEY);
          await loadConsumablesFromDb();
          return;
        }
      }
    }

    const mapped = (rows || []).map((r) => ({
      id: String(r.id),
      name: String(r.name || ""),
      category: String(r.category || ""),
      unit: String(r.unit || "pcs"),
      location: String(r.location || CONSUMABLE_LOCATIONS[0]),
      onHand: Number(r.on_hand || 0) || 0,
      minLevel: Number(r.min_level || 0) || 0,
      changedByName: String(r.updated_by_name || ""),
      changedByUsername: String(r.updated_by_username || ""),
      updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
    }));

    setConsumables(mapped);
  }

  async function loadFeedbacksFromDb() {
    let query = supabase
      .from("feedback_entries")
      .select("id, created_at, message, sender_name, sender_username, sender_user_id, resolved")
      .order("created_at", { ascending: false })
      .limit(200);

    if (!isAdmin) {
      if (authIdentity?.id) query = query.eq("sender_user_id", authIdentity.id);
      else if (currentUser) query = query.eq("sender_username", currentUser);
    }

    const { data, error } = await query;
    if (error) return;
    setFeedbackRows(Array.isArray(data) ? data : []);
  }


  const stats = useMemo(() => {
    const total = items.length;
    const checked = items.filter((i) => i.checked).length;
    const missing = total - checked;
    return { total, checked, missing };
  }, [items]);

  const consumableStats = useMemo(() => {
    const total = consumables.length;
    const low = consumables.filter((c) => Number(c.onHand || 0) <= Number(c.minLevel || 0)).length;
    const healthy = total - low;
    return { total, low, healthy };
  }, [consumables]);

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
    if (sort === "unsorted") out = [...out];
    if (sort === "name") out = [...out].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "location")
      out = [...out].sort((a, b) => (a.location || "").localeCompare(b.location || ""));

    return out;
  }, [items, query, filter, sort]);

  const globalSearchResults = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    if (!q) return [];

    const results = [];

    for (const item of items) {
      const name = String(item.name || "");
      if (!name.toLowerCase().includes(q)) continue;
      results.push({
        id: item.id,
        name,
        page: "equipment",
        meta: item.location || "No location",
      });
    }

    for (const row of consumables) {
      const name = String(row.name || "");
      if (!name.toLowerCase().includes(q)) continue;
      results.push({
        id: row.id,
        name,
        page: "consumables",
        meta: row.location || "No location",
      });
    }

    return results
      .filter((r) => r.page !== "equipment" || isAdmin)
      .slice(0, 8);
  }, [globalSearch, items, consumables, isAdmin]);

  useEffect(() => {
    if (activePage !== "equipment") return;
    if (!equipmentJump?.id) return;
    const el = document.getElementById(`equipment-${equipmentJump.id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activePage, equipmentJump?.at, filtered.length]);

  function jumpToSearchResult(result) {
    if (result.page === "equipment") {
      if (!isAdmin) {
        setToast("You don't have priviledge, please contact admin");
        return;
      }
      setActivePage("equipment");
      setQuery(result.name);
      setFilter("all");
      setSort("recent");
      setEquipmentJump({ id: result.id, at: Date.now() });
      setGlobalSearch("");
      return;
    }

    setActivePage("consumables");
    setConsumableJump({ id: result.id, location: result.meta || "", at: Date.now() });
    setGlobalSearch("");
  }

  async function upsertItem(partial) {
  const isCheckedOnlyUpdate =
    "checked" in partial &&
    Object.keys(partial).every((k) => k === "id" || k === "checked");
  if (!isAdmin && !isCheckedOnlyUpdate) {
    setToast("Only admin can edit item details.");
    return;
  }
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
    if (!isAdmin) {
      setToast("Only admin can add items.");
      return;
    }
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
      setShowAddDialog(false);
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
  if (!isAdmin) {
    setToast("Only admin can delete items.");
    return;
  }
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

  async function addConsumable(e) {
    e.preventDefault();
    if (!isAdmin) {
      setToast("You don't have priviledge, please contact admin");
      return false;
    }
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") || "").trim();
    if (!name) return false;
    const category = String(fd.get("category") || "").trim();
    const unit = String(fd.get("unit") || "").trim() || "pcs";
    const location = String(fd.get("location") || "").trim() || CONSUMABLE_LOCATIONS[0];
    const onHand = Number(fd.get("onHand") || 0) || 0;
    const minLevel = Number(fd.get("minLevel") || 0) || 0;

    const row = {
      id: genUuid(),
      name,
      category,
      unit,
      location,
      on_hand: onHand,
      min_level: minLevel,
      updated_by_name: currentName || currentUser || "Unknown",
      updated_by_username: currentUser || "unknown",
    };
    const { error } = await supabase.from("consumables_items").insert([row], { returning: "minimal" });
    if (error) {
      setToast("Consumable add error: " + error.message);
      return false;
    }
    await loadConsumablesFromDb();
    e.currentTarget.reset();
    setToast("Consumable added");
    return true;
  }

  async function adjustConsumable(id, delta) {
    const current = consumables.find((c) => c.id === id);
    if (!current) return;
    const nextOnHand = Math.max(0, Number(current.onHand || 0) + delta);
    const currentOnHand = Number(current.onHand || 0);
    const minLevel = Number(current.minLevel || 0);

    const { error } = await supabase
      .from("consumables_items")
      .update({
        on_hand: nextOnHand,
        updated_at: new Date().toISOString(),
        updated_by_name: currentName || currentUser || "Unknown",
        updated_by_username: currentUser || "unknown",
      })
      .eq("id", id);
    if (error) {
      setToast("Consumable update error: " + error.message);
      return;
    }

    // Trigger notification only when stock crosses from above min to at/below min.
    const wasAboveMin = currentOnHand > minLevel;
    const isNowBelowMin = nextOnHand <= minLevel;
    if (delta < 0 && !isAdmin) {
      setToast("No email trigger: you are not admin.");
    } else if (delta < 0 && !wasAboveMin) {
      setToast("No email trigger: item was already at/below min level.");
    } else if (delta < 0 && wasAboveMin && !isNowBelowMin) {
      setToast(`No email trigger: stock is still above min (${nextOnHand} > ${minLevel}).`);
    }

    if (wasAboveMin && isNowBelowMin && isAdmin) {
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token || "";
        if (sessionError || !accessToken) {
          setToast("Low-stock email failed: session expired. Please log in again.");
          return;
        }

        const payload = {
          consumable_id: id,
          name: current.name || "Unknown",
          on_hand: nextOnHand,
          min_level: minLevel,
          location: current.location || "Unknown",
          unit: current.unit || "pcs",
          updated_by_name: currentName || currentUser || "Unknown",
        };
        const { data: notifyData, error: notifyError } = await supabase.functions.invoke(
          "notify-low-stock",
          {
            body: payload,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
          }
        );
        if (notifyError) {
          console.error("notify-low-stock invoke error:", notifyError);
          let detailed = "";
          const response = notifyError?.context;
          if (response && typeof response.clone === "function") {
            try {
              const body = await response.clone().json();
              detailed = String(body?.error || body?.message || "");
            } catch {
              try {
                detailed = String(await response.clone().text());
              } catch {
                detailed = "";
              }
            }
          }
          const msg = detailed
            ? `Low-stock email failed: ${detailed}`
            : notifyError.message
              ? `Low-stock email failed: ${notifyError.message}`
              : "Low-stock email trigger failed. Check Edge Function logs.";
          setToast(msg.slice(0, 220));
        } else {
          console.log("notify-low-stock response data:", notifyData);
          if (notifyData?.message) setToast(notifyData.message);
        }
      } catch (err) {
        console.error("Failed to trigger notification:", err);
        setToast("Low-stock email trigger failed. Check Edge Function logs.");
      }
    }

    await loadConsumablesFromDb();
  }

  async function removeConsumable(id) {
    if (!isAdmin) {
      setToast("You don't have priviledge, please contact admin");
      return;
    }
    const { error } = await supabase.from("consumables_items").delete().eq("id", id);
    if (error) {
      setToast("Consumable delete error: " + error.message);
      return;
    }
    await loadConsumablesFromDb();
    setToast("Consumable removed");
  }

  async function submitFeedback(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const message = String(fd.get("message") || "").trim();
    if (!message) return;

    const payload = {
      id: genUuid(),
      message,
      sender_name: currentName || currentUser || "Unknown",
      sender_username: currentUser || "unknown",
      sender_user_id: authIdentity.id || null,
      resolved: false,
    };

    const { error } = await supabase.from("feedback_entries").insert([payload], { returning: "minimal" });
    if (error) {
      setToast("Feedback send error: " + error.message);
      return;
    }
    form.reset();
    setShowFeedbackDialog(false);
    setToast("Feedback submitted");
  }

  async function toggleFeedbackResolved(id, nextResolved) {
    if (!isAdmin) return;
    const { error } = await supabase
      .from("feedback_entries")
      .update({ resolved: !!nextResolved })
      .eq("id", id);
    if (error) {
      setToast("Feedback update error: " + error.message);
      return;
    }
    await loadFeedbacksFromDb();
    setToast(nextResolved ? "Marked resolved" : "Marked unresolved");
  }

  async function onSignup(nameRaw, usernameRaw, emailRaw, password) {
    const name = normalizeDisplayName(nameRaw);
    const username = normalizeUsername(usernameRaw);
    if (!name || !username || !password) {
      setAuthToast("Enter name + username + password");
      return;
    }
    if (!emailRaw || !emailRaw.includes("@")) {
      setAuthToast("Enter a valid email address");
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
      options: { data: { username, full_name: name, real_email: emailRaw } },
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
    const name =
      normalizeDisplayName(data?.user?.user_metadata?.full_name) ||
      normalizeDisplayName(data?.user?.user_metadata?.name);
    const realEmail = data?.user?.user_metadata?.real_email || "";
    setCurrentUser(u);
    setCurrentName(name || u);
    setIsAdmin(isAdminIdentity(data?.user, u));
    setAuthIdentity({
      id: data?.user?.id || "",
      email: data?.user?.email || "",
    });
    await upsertCurrentUserProfile(data?.user, realEmail);
    setAuthToast("Logged in");
  }

  async function onLogout() {
    await supabase.auth.signOut();
    setCurrentUser("");
    setCurrentName("");
    setIsAdmin(false);
    setShowAddDialog(false);
    setShowFeedbackDialog(false);
    setAuthIdentity({ id: "", email: "" });
    setItems([]);
    setConsumables([]);
    setFeedbackRows([]);
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
      const name =
        normalizeDisplayName(s.user.user_metadata?.full_name) ||
        normalizeDisplayName(s.user.user_metadata?.name);
      const realEmail = s.user.user_metadata?.real_email || "";
      setCurrentUser(u);
      setCurrentName(name || u);
      setIsAdmin(isAdminIdentity(s.user, u));
      setAuthIdentity({
        id: s.user.id || "",
        email: s.user.email || "",
      });
      upsertCurrentUserProfile(s.user, realEmail);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user?.user_metadata?.username || session?.user?.email?.split("@")?.[0] || "";
      const name =
        normalizeDisplayName(session?.user?.user_metadata?.full_name) ||
        normalizeDisplayName(session?.user?.user_metadata?.name);
      const realEmail = session?.user?.user_metadata?.real_email || "";
      setCurrentUser(u);
      setCurrentName(name || u);
      setIsAdmin(isAdminIdentity(session?.user, u));
      setAuthIdentity({
        id: session?.user?.id || "",
        email: session?.user?.email || "",
      });
      upsertCurrentUserProfile(session?.user, realEmail);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  if (!currentUser) {
    return (
      <AuthScreen
        toast={authToast}
        onSignup={onSignup}
        onLogin={onLogin}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      />
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.gridMesh} />
      <div style={{ ...styles.blob, ...styles.blobA }} />
      <div style={{ ...styles.blob, ...styles.blobB }} />
      <div style={{ ...styles.blob, ...styles.blobC }} />
      

      <div style={styles.container}>
        <header style={styles.header} className="fade-up">
          <div>
            <div style={styles.kicker}>UNSW Venue & Event Services</div>
            <h1 style={styles.h1}>Inventory Check</h1>
            <div style={styles.sub}>
              Signed in as <b>{currentName || currentUser}</b>
              <span style={{ ...styles.rolePill, ...(isAdmin ? styles.roleAdmin : styles.roleUser) }}>
                {isAdmin ? "Admin" : "User"}
              </span>
              <button onClick={onLogout} style={{ ...styles.btnMini, marginLeft: 10 }}>
                Logout
              </button>
            </div>
          </div>

          <div style={styles.statsRow}>
            <Stat label="Consumables" value={consumableStats.total} />
            <Stat label="Cons Low" value={consumableStats.low} />
            <Stat label="Healthy" value={consumableStats.healthy} />
          </div>
        </header>

        <div style={styles.pageTabs}>
          <button
            onClick={() => setActivePage("overview")}
            style={{ ...styles.tabBtn, ...(activePage === "overview" ? styles.tabBtnActive : {}) }}
          >
            Overview
          </button>
          <button
            onClick={() => {
              if (!isAdmin) {
                setToast("Coming soon");
                return;
              }
              setActivePage("equipment");
            }}
            style={{
              ...styles.tabBtn,
              ...(activePage === "equipment" && isAdmin ? styles.tabBtnActive : {}),
              ...(!isAdmin ? styles.tabBtnDisabled : {}),
            }}
          >
            Equipment
          </button>
          <button
            onClick={() => setActivePage("consumables")}
            style={{ ...styles.tabBtn, ...(activePage === "consumables" ? styles.tabBtnActive : {}) }}
          >
            Consumables
          </button>
          <button
            onClick={() => setActivePage("feedback")}
            style={{ ...styles.tabBtn, ...(activePage === "feedback" ? styles.tabBtnActive : {}) }}
          >
            Feedback
          </button>
        </div>

        <section style={styles.card} className="fade-up">
          <div style={styles.cardTitle}>Search items</div>
          <input
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            placeholder="Search by item name..."
            style={{ ...styles.search, width: "100%", minWidth: 0 }}
          />
          {globalSearch.trim() ? (
            <div style={styles.searchResultList}>
              {globalSearchResults.length === 0 ? (
                <div style={styles.empty}>No item name matches.</div>
              ) : (
                globalSearchResults.map((result) => (
                  <button
                    key={`${result.page}-${result.id}`}
                    type="button"
                    onClick={() => jumpToSearchResult(result)}
                    style={styles.searchResultBtn}
                  >
                    <div style={styles.searchResultTitle}>{result.name}</div>
                    <div style={styles.searchResultMeta}>
                      {result.page === "equipment" ? "Equipment" : "Consumables"} · {result.meta}
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </section>

        <section
          style={{
            ...styles.statusCard,
            ...(consumableStats.low > 0 ? styles.statusBad : styles.statusGood),
          }}
          className="fade-up"
        >
          {consumableStats.low > 0
            ? "Oh no, check in what needs to be refilled"
            : "Great job, everything is in good quantity"}
        </section>

        {activePage === "overview" ? (
          <OverviewPage
            consumableStats={consumableStats}
            consumables={consumables}
            isAdmin={isAdmin}
            onLowStockSelect={(item) => {
              setActivePage("consumables");
              setConsumableJump({
                id: item.id,
                location: item.location || "",
                at: Date.now(),
              });
            }}
          />
        ) : null}

        {activePage === "equipment" && isAdmin ? (
          <div style={styles.grid}>
            <section style={styles.card} className="fade-up">
              <div style={styles.cardTitle}>Workspace controls</div>
              <button
                onClick={() => {
                  if (!isAdmin) {
                    setToast("You don't have priviledge, please contact admin");
                    return;
                  }
                  setAddError("");
                  setAddDebug("");
                  setShowAddDialog(true);
                }}
                style={{ ...styles.btn, ...styles.btnPrimary }}
              >
                Add Item
              </button>

              <div style={styles.divider} />

              <div style={styles.cardTitle}>Stocktake controls</div>
              <div style={styles.controls}>
                <button onClick={markAllChecked} style={styles.btn}>
                  Mark all checked
                </button>
                <button onClick={resetChecks} style={styles.btn}>
                  Reset checks
                </button>
                {isAdmin ? (
                  <>
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
                  </>
                ) : null}
              </div>
              {!isAdmin ? (
                <div style={{ ...styles.restrictedBox, marginTop: 10 }}>
                  Add/delete/edit permissions are restricted to admin users. You can still check and uncheck items.
                </div>
              ) : null}
            </section>

            <section style={{ ...styles.card, ...styles.cardTall, animationDelay: "90ms" }} className="fade-up">
              <div style={styles.listTop}>
                <div style={styles.cardTitle}>Inventory items</div>

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
                    <option value="unsorted">Unsorted</option>
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
                      rowId={`equipment-${it.id}`}
                      item={it}
                      onToggle={() => upsertItem({ id: it.id, checked: !it.checked })}
                      onEdit={(patch) => upsertItem({ id: it.id, ...patch })}
                      onDelete={() => removeItem(it.id)}
                      canManage={isAdmin}
                    />
                  ))
                )}
              </div>
            </section>
          </div>
        ) : null}

        {activePage === "consumables" ? (
          <ConsumablesPage
            consumables={consumables}
            isAdmin={isAdmin}
            onAdd={addConsumable}
            onAdjust={adjustConsumable}
            onDelete={removeConsumable}
            onNoPrivilege={() => setToast("You don't have priviledge, please contact admin")}
            jumpTarget={consumableJump}
          />
        ) : null}

        {activePage === "feedback" ? (
          <FeedbackPage
            isAdmin={isAdmin}
            feedbackRows={feedbackRows}
            onOpenForm={() => setShowFeedbackDialog(true)}
            onToggleResolved={toggleFeedbackResolved}
          />
        ) : null}

        {showAddDialog && isAdmin ? (
          <div style={styles.modalBackdrop} onClick={() => setShowAddDialog(false)}>
            <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
              <div style={styles.modalHeader}>
                <div style={styles.modalTitle}>Add item</div>
                <button
                  type="button"
                  onClick={() => setShowAddDialog(false)}
                  style={{ ...styles.btnMini, ...styles.btnMiniGhost }}
                >
                  Close
                </button>
              </div>

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

                <div style={styles.modalActions}>
                  <button
                    type="submit"
                    disabled={isAdding}
                    style={{ ...styles.btn, ...styles.btnPrimary, opacity: isAdding ? 0.7 : 1 }}
                  >
                    {isAdding ? "Adding..." : "Add item"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddDialog(false)}
                    style={{ ...styles.btn, ...styles.btnGhost }}
                  >
                    Cancel
                  </button>
                </div>
                {addError ? <div style={{ fontSize: 12, color: "#fca5a5" }}>{addError}</div> : null}
                {addDebug ? <div style={{ fontSize: 12, opacity: 0.85 }}>{addDebug}</div> : null}
              </form>
            </div>
          </div>
        ) : null}

        {showFeedbackDialog ? (
          <div style={styles.modalBackdrop} onClick={() => setShowFeedbackDialog(false)}>
            <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
              <div style={styles.modalHeader}>
                <div style={styles.modalTitle}>Send feedback</div>
                <button
                  type="button"
                  onClick={() => setShowFeedbackDialog(false)}
                  style={{ ...styles.btnMini, ...styles.btnMiniGhost }}
                >
                  Close
                </button>
              </div>
              <form onSubmit={submitFeedback} style={styles.form}>
                <textarea
                  name="message"
                  required
                  placeholder="Write your feedback here..."
                  style={{ ...styles.input, minHeight: 120, resize: "vertical" }}
                />
                <div style={styles.modalActions}>
                  <button type="submit" style={{ ...styles.btn, ...styles.btnPrimary }}>
                    Submit feedback
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowFeedbackDialog(false)}
                    style={{ ...styles.btn, ...styles.btnGhost }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        <button
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          style={styles.themeToggleFloating}
        >
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>

        {toast ? (
          <div
            className="toast-pop"
            style={{ ...styles.toast, ...(toastLeaving ? styles.toastOut : styles.toastIn) }}
          >
            {toast}
          </div>
        ) : null}
        <footer style={styles.footer}>Any questions please reach out to Full-Time staff</footer>
      </div>
    </div>
  );
}


function AuthScreen({ toast, onSignup, onLogin, theme, onToggleTheme }) {
  const [mode, setMode] = useState("login"); // login | signup
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div style={styles.page}>
      <div style={styles.gridMesh} />
      <div style={{ ...styles.blob, ...styles.blobA }} />
      <div style={{ ...styles.blob, ...styles.blobB }} />
      <div style={{ ...styles.blob, ...styles.blobC }} />

      <div style={styles.container}>
        <header style={styles.header} className="fade-up">
          <div>
            <div style={styles.kicker}>UNSW Venue & Event Services</div>
            <h1 style={styles.h1}>Inventory Check</h1>
            <div style={styles.sub}>Secure login</div>
          </div>
        </header>

        <section style={{ ...styles.card, maxWidth: 520 }} className="fade-up">
          <div style={styles.cardTitle}>{mode === "login" ? "Login" : "Sign up"}</div>

          <div style={styles.form}>
            {mode === "signup" ? (
              <>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name"
                  style={styles.input}
                />
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  type="email"
                  style={styles.input}
                />
              </>
            ) : null}
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
              <button onClick={() => onSignup(name, username, email, password)} style={{ ...styles.btn, ...styles.btnPrimary }}>
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
        <button onClick={onToggleTheme} style={styles.themeToggleFloating}>
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
      </div>
    </div>
  );
}

function OverviewPage({ consumableStats, consumables, isAdmin, onLowStockSelect }) {
  const recentConsumables = [...consumables].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 5);
  const lowRows = consumables
    .filter((c) => Number(c.onHand || 0) <= Number(c.minLevel || 0))
    .slice(0, 5);

  return (
    <div style={{ ...styles.grid, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
      <section style={styles.card} className="fade-up">
        <div style={styles.cardTitle}>Consumables snapshot</div>
        <div style={styles.overviewStatStack}>
          <div style={styles.overviewStatRow}><span>Total SKUs</span><b>{consumableStats.total}</b></div>
          <div style={styles.overviewStatRow}><span>Low stock</span><b>{consumableStats.low}</b></div>
          <div style={styles.overviewStatRow}><span>Healthy</span><b>{consumableStats.healthy}</b></div>
        </div>
      </section>

      <section style={{ ...styles.card, ...styles.cardTall, ...styles.lowStockCard }} className="fade-up">
        <div style={styles.cardTitle}>Low-stock alert</div>
        <div style={styles.list}>
          {lowRows.length ? lowRows.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onLowStockSelect?.(c)}
              style={{ ...styles.overviewRow, ...styles.lowStockRow, ...styles.lowStockTap }}
            >
              <div style={styles.overviewMainText}>{c.name}</div>
              <div style={styles.overviewSubText}>
                {c.onHand} {c.unit} left (min {c.minLevel}) · {c.location || "Unassigned"}
              </div>
            </button>
          )) : <div style={styles.empty}>No low-stock consumables.</div>}
        </div>
      </section>

      {isAdmin ? (
        <section style={{ ...styles.card, ...styles.cardTall, ...styles.overviewWideCard }} className="fade-up">
          <div style={styles.cardTitle}>Recent consumables activity</div>
          <div style={styles.list}>
            {recentConsumables.length ? recentConsumables.map((c) => (
              <div key={c.id} style={styles.overviewRow}>
                <div style={styles.overviewMainText}>{c.name}</div>
                <div style={styles.overviewSubText}>
                  {c.onHand} {c.unit || "pcs"} on hand · {c.location || "Unassigned"} · by {c.changedByName || c.changedByUsername || "Unknown"} · {fmtTime(c.updatedAt)}
                </div>
              </div>
            )) : <div style={styles.empty}>No recent activity.</div>}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ConsumablesPage({ consumables, isAdmin, onAdd, onAdjust, onDelete, onNoPrivilege, jumpTarget }) {
  const [locationFilter, setLocationFilter] = useState("");
  const [showAddConsumable, setShowAddConsumable] = useState(false);

  function consumableEmoji(row) {
    const text = `${row.name || ""} ${row.category || ""}`.toLowerCase();
    if (text.includes("battery") || text.includes("power")) return "🔋";
    if (text.includes("tape")) return "🟨";
    if (text.includes("label")) return "🏷️";
    if (text.includes("clean")) return "🧴";
    if (text.includes("glove")) return "🧤";
    if (text.includes("paper")) return "📄";
    if (text.includes("cable")) return "🔌";
    return "📦";
  }

  const filteredConsumables = locationFilter
    ? consumables.filter((c) => String(c.location || "") === locationFilter)
    : [];

  useEffect(() => {
    if (!jumpTarget?.id) return;
    if (jumpTarget.location) setLocationFilter(jumpTarget.location);
  }, [jumpTarget?.at]);

  useEffect(() => {
    if (!jumpTarget?.id) return;
    if (jumpTarget.location && locationFilter !== jumpTarget.location) return;
    const el = document.getElementById(`consumable-${jumpTarget.id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [jumpTarget?.at, locationFilter, filteredConsumables.length]);

  function openAddConsumable() {
    if (!isAdmin) {
      onNoPrivilege?.();
      return;
    }
    setShowAddConsumable(true);
  }

  async function submitAddConsumable(e) {
    const ok = await onAdd(e);
    if (ok) setShowAddConsumable(false);
  }

  return (
    <div style={styles.fullWidthStack}>
      <section style={styles.card} className="fade-up">
        <div style={styles.listTop}>
          <div style={styles.cardTitle}>Consumables gallery</div>
          <div style={styles.listControls}>
            <div style={styles.locationFilterBlock}>
              <div style={styles.locationLabel}>Choose a location</div>
              <div style={styles.locationButtonRow}>
                {CONSUMABLE_LOCATIONS.map((loc) => (
                  <button
                    key={loc}
                    onClick={() => setLocationFilter(loc)}
                    style={{ ...styles.locationBtn, ...(locationFilter === loc ? styles.locationBtnActive : {}) }}
                  >
                    {loc}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={openAddConsumable} style={{ ...styles.plusBtn, ...(isAdmin ? {} : styles.plusBtnLocked) }}>
              +
            </button>
          </div>
        </div>

        {filteredConsumables.length === 0 ? (
          <div style={styles.empty}>
            {locationFilter ? "No consumables in this location yet." : "Choose a location to view consumables."}
          </div>
        ) : (
          <div style={styles.consumableGallery} className="consumable-gallery">
            {filteredConsumables.map((c) => {
              const low = Number(c.onHand || 0) <= Number(c.minLevel || 0);
              return (
                <article id={`consumable-${c.id}`} key={c.id} style={styles.consumableCard}>
                  <div style={styles.consumableEmoji}>{consumableEmoji(c)}</div>
                  <div style={styles.consumableName}>{c.name}</div>
                  <div style={styles.consumableMeta}>
                    {c.category || "General"} · {c.unit || "pcs"} · {c.location || "Unassigned"}
                  </div>
                  <div style={{ ...styles.pill, ...(low ? styles.pillWarn : styles.pillOk) }}>
                    {low ? `Low (min ${c.minLevel})` : "Healthy"}
                  </div>
                  <div style={styles.consumableCount}>
                    {c.onHand} {c.unit || "pcs"}
                  </div>
                  <div style={styles.consumableActions}>
                    <button onClick={() => onAdjust(c.id, -1)} style={{ ...styles.qtyBtn, ...styles.qtyMinus }}>
                      −
                    </button>
                    <button onClick={() => onAdjust(c.id, +1)} style={{ ...styles.qtyBtn, ...styles.qtyPlus }}>
                      +
                    </button>
                  </div>
                  {isAdmin ? (
                    <button onClick={() => onDelete(c.id)} style={{ ...styles.btnMini, ...styles.btnMiniDanger, width: "100%" }}>
                      Delete
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {showAddConsumable ? (
        <div style={styles.modalBackdrop} onClick={() => setShowAddConsumable(false)}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>Add consumable</div>
              <button
                type="button"
                onClick={() => setShowAddConsumable(false)}
                style={{ ...styles.btnMini, ...styles.btnMiniGhost }}
              >
                Close
              </button>
            </div>
            <form onSubmit={submitAddConsumable} style={styles.form}>
              <Input name="name" placeholder="Name (required)" required />
              <div style={styles.row2}>
                <Input name="category" placeholder="Category" />
                <Input name="unit" placeholder="Unit" />
              </div>
              <div style={styles.row2}>
                <select name="location" defaultValue={CONSUMABLE_LOCATIONS[0]} style={styles.select}>
                  {CONSUMABLE_LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
                <Input name="onHand" type="number" placeholder="On hand" defaultValue={0} min={0} />
              </div>
              <div style={styles.row2}>
                <Input name="minLevel" type="number" placeholder="Min level" defaultValue={0} min={0} />
                <div />
              </div>
              <div style={styles.modalActions}>
                <button type="submit" style={{ ...styles.btn, ...styles.btnPrimary }}>Add consumable</button>
                <button
                  type="button"
                  onClick={() => setShowAddConsumable(false)}
                  style={{ ...styles.btn, ...styles.btnGhost }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FeedbackPage({ isAdmin, feedbackRows, onOpenForm, onToggleResolved }) {
  return (
    <div style={styles.fullWidthStack}>
      <section style={styles.card} className="fade-up">
        <div style={styles.listTop}>
          <div style={styles.cardTitle}>Feedback</div>
          <button onClick={onOpenForm} style={{ ...styles.btn, ...styles.btnPrimary }}>
            Send feedback
          </button>
        </div>
        <div style={styles.feedbackHelp}>
          Share issues, requests, and ideas for improving inventory workflow.
        </div>
      </section>

      {isAdmin ? (
        <section style={{ ...styles.card, ...styles.cardTall }} className="fade-up">
          <div style={styles.cardTitle}>Submitted feedback (admin)</div>
          <div style={styles.list}>
            {feedbackRows.length === 0 ? (
              <div style={styles.empty}>No feedback submitted yet.</div>
            ) : (
              feedbackRows.map((f) => (
                <div key={f.id} style={styles.feedbackRow}>
                  <div style={styles.feedbackTop}>
                    <b>{f.sender_name || "Unknown"}</b>
                    <div style={styles.feedbackMetaWrap}>
                      <span style={styles.overviewSubText}>
                        @{f.sender_username || "unknown"} · {fmtTime(new Date(f.created_at).getTime())}
                      </span>
                      <span style={{ ...styles.feedbackStatus, ...(f.resolved ? styles.feedbackResolved : styles.feedbackUnresolved) }}>
                        {f.resolved ? "Resolved" : "Unresolved"}
                      </span>
                    </div>
                  </div>
                  <div>{f.message}</div>
                  <div style={styles.feedbackActions}>
                    <button
                      type="button"
                      onClick={() => onToggleResolved(f.id, !f.resolved)}
                      style={{ ...styles.btnMini, ...(f.resolved ? styles.btnMiniGhost : styles.btnMiniPrimary) }}
                    >
                      {f.resolved ? "Unresolve" : "Resolve"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      ) : (
        <section style={styles.card} className="fade-up">
          <div style={styles.cardTitle}>My feedback</div>
          <div style={styles.list}>
            {feedbackRows.length === 0 ? (
              <div style={styles.empty}>No feedback submitted yet.</div>
            ) : (
              feedbackRows.map((f) => (
                <div key={f.id} style={styles.feedbackRow}>
                  <div style={styles.feedbackTop}>
                    <span style={styles.overviewSubText}>{fmtTime(new Date(f.created_at).getTime())}</span>
                    <span style={{ ...styles.feedbackStatus, ...(f.resolved ? styles.feedbackResolved : styles.feedbackUnresolved) }}>
                      {f.resolved ? "Resolved" : "Unresolved"}
                    </span>
                  </div>
                  <div>{f.message}</div>
                </div>
              ))
            )}
          </div>
        </section>
      )}
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

function ItemRow({ rowId, item, onToggle, onEdit, onDelete, canManage }) {
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
    <div id={rowId} style={styles.itemRow}>
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
        {canManage ? (
          <>
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
          </>
        ) : (
          <div style={styles.readOnlyHint}>Check/uncheck only</div>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    color: "var(--text-primary)",
    background: "var(--page-bg)",
    position: "relative",
    overflowX: "hidden",
    fontFamily:
      '"Sora", "Manrope", "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif',
  },

  gridMesh: {
    position: "absolute",
    inset: 0,
    backgroundImage:
      "linear-gradient(var(--mesh-line) 1px, transparent 1px), linear-gradient(90deg, var(--mesh-line) 1px, transparent 1px)",
    backgroundSize: "44px 44px",
    maskImage: "radial-gradient(ellipse at center, black 50%, transparent 95%)",
    pointerEvents: "none",
    opacity: 0.28,
  },
  blob: { position: "absolute", filter: "blur(56px)", opacity: 0.52, borderRadius: "999px", pointerEvents: "none" },
  blobA: {
    width: 600,
    height: 600,
    left: -220,
    top: -240,
    background: "radial-gradient(circle at 30% 30%, rgba(20, 184, 166, 0.95), rgba(20, 184, 166, 0) 64%)",
  },
  blobB: {
    width: 460,
    height: 460,
    right: -160,
    top: 80,
    background: "radial-gradient(circle at 30% 30%, rgba(34, 197, 94, 0.85), rgba(34, 197, 94, 0) 64%)",
  },
  blobC: {
    width: 520,
    height: 520,
    left: 220,
    bottom: -300,
    background: "radial-gradient(circle at 30% 30%, rgba(56, 189, 248, 0.78), rgba(56, 189, 248, 0) 64%)",
  },

  container: {
    maxWidth: 1220,
    margin: "0 auto",
    padding: "clamp(18px, 4vw, 44px)",
    position: "relative",
    zIndex: 1,
  },
  header: {
    display: "flex",
    gap: 20,
    alignItems: "flex-end",
    justifyContent: "space-between",
    flexWrap: "wrap",
    marginBottom: 20,
  },
  kicker: {
    fontSize: 11,
    letterSpacing: 1.9,
    textTransform: "uppercase",
    opacity: 0.82,
    color: "var(--text-muted)",
  },
  h1: {
    fontSize: "clamp(28px, 5.2vw, 52px)",
    letterSpacing: "-0.03em",
    margin: "8px 0 8px",
    lineHeight: 0.98,
    fontWeight: 650,
  },
  sub: {
    opacity: 0.9,
    maxWidth: 620,
    color: "var(--text-soft)",
    fontSize: "clamp(13px, 2vw, 15px)",
  },
  rolePill: {
    display: "inline-block",
    marginLeft: 10,
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    fontWeight: 700,
    border: "1px solid var(--field-border)",
  },
  roleAdmin: {
    color: "#d1fae5",
    background: "rgba(6, 95, 70, 0.38)",
    borderColor: "rgba(16, 185, 129, 0.55)",
  },
  roleUser: {
    color: "#dbeafe",
    background: "rgba(30, 64, 175, 0.26)",
    borderColor: "rgba(59, 130, 246, 0.42)",
  },

  statsRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  stat: {
    padding: "10px 14px",
    borderRadius: 14,
    background: "var(--panel-bg)",
    border: "1px solid var(--panel-border)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
    minWidth: 118,
  },
  statLabel: { fontSize: 11.5, opacity: 0.75, textTransform: "uppercase", letterSpacing: 0.8 },
  statValue: { fontSize: 22, fontWeight: 700 },
  pageTabs: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 14,
  },
  tabBtn: {
    padding: "8px 12px",
    borderRadius: 999,
    border: "1px solid var(--tab-border)",
    background: "var(--tab-bg)",
    color: "var(--tab-text)",
    fontWeight: 600,
    letterSpacing: 0.2,
    cursor: "pointer",
  },
  tabBtnDisabled: {
    opacity: 0.56,
    filter: "grayscale(0.45)",
    cursor: "not-allowed",
  },
  locationFilterBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  locationLabel: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--text-muted)",
  },
  locationButtonRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },
  locationBtn: {
    minHeight: 50,
    padding: "12px 18px",
    borderRadius: 12,
    border: "1px solid var(--field-border)",
    background: "var(--field-bg)",
    color: "var(--text-primary)",
    fontWeight: 700,
    cursor: "pointer",
  },
  locationBtnActive: {
    border: "1px solid var(--accent-border)",
    background: "var(--accent-bg)",
    color: "var(--tab-active-text)",
    boxShadow: "var(--accent-shadow)",
  },
  plusBtn: {
    width: 52,
    height: 52,
    borderRadius: 999,
    border: "1px solid var(--accent-border)",
    background: "var(--accent-bg)",
    color: "var(--tab-active-text)",
    cursor: "pointer",
    fontSize: 34,
    lineHeight: 1,
    fontWeight: 700,
    display: "grid",
    placeItems: "center",
    boxShadow: "var(--accent-shadow)",
  },
  plusBtnLocked: {
    opacity: 0.65,
    filter: "grayscale(0.25)",
  },
  tabBtnActive: {
    border: "1px solid var(--tab-active-border)",
    background: "var(--tab-active-bg)",
    color: "var(--tab-active-text)",
  },
  statusCard: {
    marginBottom: 14,
    borderRadius: 14,
    padding: "12px 14px",
    fontWeight: 700,
    fontSize: 15,
    border: "1px solid var(--field-border)",
    background: "var(--panel-bg)",
  },
  statusGood: {
    border: "1px solid rgba(16, 185, 129, 0.55)",
    background: "linear-gradient(180deg, rgba(16, 185, 129, 0.2), rgba(6, 78, 59, 0.18))",
    color: "var(--text-primary)",
  },
  statusBad: {
    border: "1px solid rgba(239, 68, 68, 0.6)",
    background: "linear-gradient(180deg, rgba(239, 68, 68, 0.2), rgba(127, 29, 29, 0.2))",
    color: "var(--text-primary)",
  },

  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "clamp(12px, 2.2vw, 24px)",
  },
  fullWidthStack: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  card: {
    borderRadius: 20,
    background: "var(--card-bg)",
    border: "1px solid var(--card-border)",
    boxShadow: "var(--shadow-elev)",
    backdropFilter: "blur(18px)",
    padding: 18,
  },
  cardTall: {
    minHeight: 0,
  },

  cardTitle: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 10,
    fontWeight: 600,
  },

  form: { display: "flex", flexDirection: "column", gap: 10 },
  row2: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 },
  input: {
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid var(--field-border)",
    background: "var(--field-bg)",
    color: "var(--text-primary)",
    outline: "none",
    transition: "border-color 120ms ease, background-color 120ms ease, box-shadow 120ms ease",
  },

  btn: {
    padding: "11px 12px",
    borderRadius: 12,
    border: "1px solid var(--field-border)",
    background: "var(--field-bg)",
    color: "var(--text-primary)",
    cursor: "pointer",
    fontWeight: 650,
    transition: "all 120ms ease",
  },
  btnPrimary: {
    border: "1px solid var(--accent-border)",
    background: "var(--accent-bg)",
    boxShadow: "var(--accent-shadow)",
  },
  btnGhost: { background: "var(--ghost-bg)" },

  divider: { height: 1, background: "var(--divider)", margin: "14px 0" },
  controls: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 },
  restrictedBox: {
    borderRadius: 12,
    border: "1px solid var(--field-border)",
    background: "var(--field-bg)",
    color: "var(--text-soft)",
    padding: "12px 12px",
    fontSize: 13,
    lineHeight: 1.4,
  },
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
    borderRadius: 12,
    border: "1px solid var(--field-border)",
    background: "var(--field-bg)",
    color: "var(--text-primary)",
    outline: "none",
    minWidth: 240,
  },
  searchResultList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginTop: 10,
  },
  searchResultBtn: {
    width: "100%",
    textAlign: "left",
    borderRadius: 12,
    border: "1px solid var(--card-border)",
    background: "var(--panel-bg)",
    color: "var(--text-primary)",
    padding: "10px 12px",
    cursor: "pointer",
  },
  searchResultTitle: {
    fontWeight: 650,
    lineHeight: 1.2,
  },
  searchResultMeta: {
    marginTop: 4,
    fontSize: 12,
    color: "var(--text-muted)",
  },
  select: {
    padding: "10px 10px",
    borderRadius: 12,
    border: "1px solid var(--field-border)",
    background: "var(--field-bg)",
    color: "var(--text-primary)",
    outline: "none",
  },

  list: { display: "flex", flexDirection: "column", gap: 10, marginTop: 8, overflow: "visible" },
  consumableGallery: {
    marginTop: 10,
    display: "grid",
    gap: 12,
  },
  consumableCard: {
    borderRadius: 16,
    border: "1px solid var(--card-border)",
    background: "var(--panel-bg)",
    boxShadow: "var(--shadow-elev)",
    padding: 14,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    minHeight: 260,
  },
  consumableEmoji: {
    fontSize: 64,
    lineHeight: 1,
    marginTop: 2,
    marginBottom: 2,
  },
  consumableName: {
    fontSize: 18,
    fontWeight: 700,
    textAlign: "center",
    lineHeight: 1.15,
  },
  consumableMeta: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    textAlign: "center",
  },
  consumableCount: {
    fontSize: 17,
    fontWeight: 700,
    marginTop: 4,
  },
  consumableActions: {
    marginTop: 4,
    width: "100%",
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
  },
  qtyBtn: {
    borderRadius: 12,
    border: "1px solid var(--field-border)",
    background: "var(--field-bg)",
    color: "var(--text-primary)",
    cursor: "pointer",
    fontSize: 44,
    lineHeight: 1,
    minHeight: 82,
    fontWeight: 800,
  },
  qtyMinus: {
    background: "var(--ghost-bg)",
  },
  qtyPlus: {
    border: "1px solid var(--accent-border)",
    background: "var(--accent-bg)",
  },
  feedbackHelp: {
    color: "var(--text-soft)",
    fontSize: 14,
    lineHeight: 1.45,
  },
  feedbackRow: {
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid var(--card-border)",
    background: "var(--panel-bg)",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  feedbackTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  feedbackMetaWrap: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  feedbackStatus: {
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 11.5,
    fontWeight: 700,
    border: "1px solid var(--field-border)",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  feedbackResolved: {
    border: "1px solid rgba(16, 185, 129, 0.55)",
    background: "rgba(16, 185, 129, 0.2)",
    color: "var(--text-primary)",
  },
  feedbackUnresolved: {
    border: "1px solid rgba(239, 68, 68, 0.55)",
    background: "rgba(239, 68, 68, 0.16)",
    color: "var(--text-primary)",
  },
  feedbackActions: {
    display: "flex",
    justifyContent: "flex-end",
    marginTop: 2,
  },
  empty: { padding: 18, opacity: 0.74, border: "1px dashed var(--dash-border)", borderRadius: 14 },
  overviewStatStack: { display: "flex", flexDirection: "column", gap: 8 },
  overviewStatRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid var(--card-border)",
    background: "var(--panel-bg)",
  },
  overviewRow: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid var(--card-border)",
    background: "var(--panel-bg)",
  },
  overviewWideCard: {
    gridColumn: "1 / -1",
    minHeight: 260,
  },
  lowStockCard: {
    border: "1px solid rgba(239, 68, 68, 0.5)",
    boxShadow: "0 0 0 1px rgba(239, 68, 68, 0.24), var(--shadow-elev)",
  },
  lowStockRow: {
    border: "1px solid rgba(239, 68, 68, 0.44)",
    background: "linear-gradient(180deg, rgba(127, 29, 29, 0.34), rgba(69, 10, 10, 0.22))",
  },
  lowStockTap: {
    width: "100%",
    textAlign: "left",
    cursor: "pointer",
  },
  overviewMainText: { fontWeight: 650 },
  overviewSubText: { marginTop: 4, fontSize: 12.5, color: "var(--text-muted)" },

  itemRow: {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    padding: 12,
    borderRadius: 14,
    border: "1px solid var(--card-border)",
    background: "var(--field-bg)",
  },
  check: {
    width: 34,
    height: 34,
    borderRadius: 10,
    border: "1px solid var(--field-border)",
    background: "var(--panel-bg)",
    color: "var(--text-primary)",
    cursor: "pointer",
    fontWeight: 900,
    display: "grid",
    placeItems: "center",
    flex: "0 0 auto",
  },
  checkOn: {
    border: "1px solid var(--accent-border)",
    background: "var(--accent-bg)",
  },

  itemMain: { flex: "1 1 auto", minWidth: 0 },
  itemTop: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" },
  itemName: {
    fontSize: 15.5,
    fontWeight: 650,
    lineHeight: 1.2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  pill: {
    fontSize: 11.5,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid var(--chip-border)",
    background: "var(--chip-bg)",
    whiteSpace: "nowrap",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  pillOk: { border: "1px solid rgba(16, 185, 129, 0.45)", color: "#d1fae5" },
  pillWarn: { border: "1px solid rgba(251, 191, 36, 0.44)", color: "#fde68a", opacity: 0.95 },

  meta: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, opacity: 0.92 },
  badge: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid var(--field-border)",
    background: "var(--panel-bg)",
  },
  badgeSoft: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid var(--chip-soft-border)",
    background: "var(--chip-soft-bg)",
  },

  actions: { display: "flex", flexDirection: "column", gap: 8, flex: "0 0 auto" },
  readOnlyHint: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    border: "1px dashed var(--dash-border)",
    borderRadius: 10,
    padding: "6px 8px",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  btnMini: {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid var(--field-border)",
    background: "var(--panel-bg)",
    color: "var(--text-primary)",
    cursor: "pointer",
    fontWeight: 650,
    fontSize: 12.5,
  },
  btnMiniPrimary: {
    border: "1px solid var(--accent-border)",
    background: "var(--accent-bg)",
  },
  btnMiniGhost: { background: "var(--ghost-bg)" },
  btnMiniDanger: {
    border: "1px solid rgba(239, 68, 68, 0.42)",
    background: "rgba(127, 29, 29, 0.32)",
  },

  inlineInput: {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid var(--field-border)",
    background: "var(--field-bg)",
    color: "var(--text-primary)",
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
    background: "var(--toast-bg)",
    border: "1px solid var(--toast-border)",
    backdropFilter: "blur(14px)",
    fontWeight: 700,
    boxShadow: "var(--accent-shadow)",
    transition: "opacity 220ms ease, transform 220ms ease",
  },
  toastIn: {
    opacity: 1,
    transform: "translateX(-50%) translateY(0) scale(1)",
  },
  toastOut: {
    opacity: 0,
    transform: "translateX(-50%) translateY(10px) scale(0.98)",
  },
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "var(--overlay-bg)",
    backdropFilter: "blur(6px)",
    zIndex: 1200,
    display: "grid",
    placeItems: "center",
    padding: 16,
  },
  modalCard: {
    width: "min(620px, 100%)",
    borderRadius: 16,
    border: "1px solid var(--card-border)",
    background: "var(--card-bg)",
    boxShadow: "var(--shadow-modal)",
    padding: 16,
  },
  modalHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 14,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: "var(--text-muted)",
    fontWeight: 700,
  },
  modalActions: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  themeToggleFloating: {
    position: "absolute",
    top: 14,
    right: 14,
    zIndex: 1300,
    padding: "9px 12px",
    borderRadius: 999,
    border: "1px solid var(--field-border)",
    background: "var(--panel-bg)",
    color: "var(--text-primary)",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "var(--accent-shadow)",
  },
  footer: { marginTop: 14, opacity: 0.66, fontSize: 12.5, color: "var(--text-muted)" },
};
