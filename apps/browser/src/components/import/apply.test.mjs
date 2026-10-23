import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../../store/browser.ts");
const { importArcSpace, importTabs } = await import("./apply.ts");

const S = () => useBrowser.getState();
const PROFILES = { default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 } };
const win = (id, tabIds = []) => ({ id, profileId: "default", incognito: false, tabIds, activeTabIds: {}, sidebarOpen: true, frame: null, createdAt: 0 });
const fresh = () => S().hydrate({ profiles: PROFILES, windows: { w1: win("w1") }, tabs: {}, groups: {}, focusedWindowId: "w1" });

const tab = (url, title, groupId) => ({ url, title, pinned: false, groupId, windowIndex: 0, active: false });
const groupsByName = () => Object.fromEntries(Object.values(S().groups).map((g) => [g.name, g.tabIds.map((id) => S().tabs[id].url)]));
// The window the import used: the one every imported tab sits in.
const windowUrls = () => {
  const ids = Object.values(S().tabs).map((t) => t.windowId);
  assert.equal(new Set(ids).size, 1, "every imported tab lands in one window");
  return S().windows[ids[0]].tabIds.map((id) => S().tabs[id].url);
};

test("an Arc space's Today folders become groups of the same name, loose tabs land in Imported", () => {
  fresh();
  const space = {
    id: "S-1", name: "Study", profileId: "default", pinned: [],
    tabs: [
      tab("https://loose.example/", "Loose"),
      tab("https://phil.example/1", "Kant", "G-1"),
      tab("https://phil.example/2", "Hume", "G-1"),
      tab("https://loose.example/2", "Loose too"),
      tab("https://travel.example/", "Flights", "L-1"),
    ],
    groups: [{ id: "G-1", title: "Philosophy", color: "grey", collapsed: false }, { id: "L-1", title: "Travel", color: "grey", collapsed: false }],
  };
  const counts = importArcSpace("default", space, "Study");
  assert.equal(counts.tabs, 5);
  assert.deepEqual(groupsByName(), {
    Imported: ["https://loose.example/", "https://loose.example/2"],
    Philosophy: ["https://phil.example/1", "https://phil.example/2"],
    Travel: ["https://travel.example/"],
  });
  // A group is one contiguous block, so Arc's interleaving gives way to: the loose tabs, then each folder in order.
  assert.deepEqual(windowUrls().filter(Boolean), [
    "https://loose.example/", "https://loose.example/2", "https://phil.example/1", "https://phil.example/2", "https://travel.example/",
  ]);
  for (const g of Object.values(S().groups)) assert.equal(g.pinned, false);
});

test("a groupId that names no folder is treated as loose", () => {
  fresh();
  importTabs("default", [tab("https://a.example/", "A", "gone"), tab("https://b.example/", "B")], "Imported", {});
  assert.deepEqual(groupsByName(), { Imported: ["https://a.example/", "https://b.example/"] });
});

test("an Arc space's pinned folders become pinned groups, nested folders flattened into them", () => {
  fresh();
  const link = (title, url) => ({ type: "url", title, url });
  importArcSpace("default", {
    id: "S-4", name: "Study", profileId: "default",
    pinned: [
      link("Calendar", "https://cal.example/"),
      { type: "folder", title: "Courses", children: [link("CS", "https://cs.example/"), { type: "folder", title: "Old", children: [link("Math", "https://math.example/")] }] },
      { type: "folder", title: "Reading", children: [link("Post", "https://read.example/")] },
    ],
    tabs: [tab("https://today.example/", "Today")],
  }, "Study");
  assert.deepEqual(groupsByName(), {
    Courses: ["https://cs.example/", "https://math.example/"],
    Reading: ["https://read.example/"],
    Imported: ["https://today.example/"],
  });
  const byName = Object.fromEntries(Object.values(S().groups).map((g) => [g.name, g]));
  assert.equal(byName.Courses.pinned, true);
  assert.equal(byName.Reading.pinned, true);
  assert.equal(byName.Imported.pinned, false);
  const cal = Object.values(S().tabs).find((t) => t.url === "https://cal.example/");
  assert.equal(cal.pinned, true, "a pinned tab at the folder level stays a pinned row");
  // Sidebar order: pinned row, then the pinned groups, then the list.
  assert.deepEqual(windowUrls().filter(Boolean), [
    "https://cal.example/", "https://cs.example/", "https://math.example/", "https://read.example/", "https://today.example/",
  ]);
  assert.equal(Object.keys(S().bookmarks.nodes).filter((id) => S().bookmarks.nodes[id].url).length, 0, "no bookmark copy of the folders");
});

test("a space without folders imports as before: one Imported group", () => {
  fresh();
  importArcSpace("default", { id: "S-2", name: "Plain", profileId: "default", pinned: [], tabs: [tab("https://a.example/", "A"), tab("https://b.example/", "B")] }, "Plain");
  assert.deepEqual(groupsByName(), { Imported: ["https://a.example/", "https://b.example/"] });
});

test("pinned links from an Arc space stay out of every group", () => {
  fresh();
  importArcSpace("default", {
    id: "S-3", name: "Pins", profileId: "default",
    pinned: [{ type: "url", title: "Cal", url: "https://cal.example/" }],
    tabs: [tab("https://t.example/", "T", "G-1")],
    groups: [{ id: "G-1", title: "Folder", color: "grey", collapsed: false }],
  }, "Pins");
  assert.deepEqual(groupsByName(), { Folder: ["https://t.example/"] });
  const pinned = Object.values(S().tabs).find((t) => t.url === "https://cal.example/");
  assert.equal(pinned.pinned, true);
});
