// An Arc import, end to end, in a hidden Debug instance: discovery through the native module, the Swift parser on the
// Mac's own ~/Library/Application Support/Arc/StorableSidebar.json, then importArcSpace into the store. Prints, per
// space, what the sidebar now holds: pinned rows, pinned groups, groups in the list and loose tabs.
//
//   node apps/browser/scripts/arc-import-e2e.mjs <Debug Ardia.app> [--data-dir DIR]
//
// Exit 0 when the import reproduces the sidebar file: every Arc folder with a tab in it is a group of that name, the
// pinned ones pinned, and no tab is lost. Exit 1 on a mismatch, 2 on usage or when no Arc data exists on this Mac.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, reporter, session } from "../../../scripts/lib/instance.mjs";

const args = process.argv.slice(2);
const appPath = args[0] && !args[0].startsWith("--") ? resolve(args[0]) : null;
if (!appPath) {
  console.error("usage: node arc-import-e2e.mjs <Debug Ardia.app> [--data-dir DIR]");
  process.exit(2);
}
const dataDir = args.includes("--data-dir") ? resolve(args[args.indexOf("--data-dir") + 1]) : null;
const sidebarPath = join(homedir(), "Library/Application Support/Arc/StorableSidebar.json");
if (!existsSync(sidebarPath)) {
  console.error(`no Arc data at ${sidebarPath}`);
  process.exit(2);
}

// What the file says, read independently of the app: per space, the folders (both shapes) and their tab counts.
function expectedFromFile() {
  const raw = JSON.parse(readFileSync(sidebarPath, "utf8"));
  const box = raw.sidebar.containers.find((c) => c && c.spaces && c.items);
  const items = Object.fromEntries(box.items.filter((i) => i && typeof i === "object" && i.id).map((i) => [i.id, i]));
  const isTab = (it) => it?.data?.tab?.savedURL;
  const folderName = (it) => (it.data?.list ? it.title || "Folder" : it.data?.tabGroup ? it.title || it.data.tabGroup.title || "Folder" : null);
  const countTabs = (id, seen) => {
    const it = items[id];
    if (!it || seen.has(id)) return 0;
    seen.add(id);
    if (isTab(it)) return 1;
    return (it.childrenIds ?? []).reduce((n, c) => n + countTabs(c, seen), 0);
  };
  const out = [];
  for (const space of box.spaces.filter((s) => s && typeof s === "object" && s.id)) {
    const ids = {};
    const list = space.containerIDs ?? [];
    for (let i = 0; i < list.length; i++) if ((list[i] === "pinned" || list[i] === "unpinned") && typeof list[i + 1] === "string") ids[list[i]] = list[i + 1];
    const section = (containerId, pinned) => {
      const seen = new Set([containerId]);
      const folders = [];
      let loose = 0;
      for (const c of items[containerId]?.childrenIds ?? []) {
        const it = items[c];
        if (!it) continue;
        if (isTab(it)) {
          if (!seen.has(c)) { seen.add(c); loose++; }
        } else if (folderName(it) !== null) {
          const n = countTabs(c, seen);
          if (n) folders.push({ name: folderName(it), tabs: n, pinned });
        } else loose += countTabs(c, seen);
      }
      return { folders, loose };
    };
    const pinned = section(ids.pinned, true);
    const today = section(ids.unpinned, false);
    out.push({ name: space.title || "Space", pinnedRows: pinned.loose, pinnedFolders: pinned.folders, todayLoose: today.loose, todayFolders: today.folders });
  }
  return out;
}

const expected = expectedFromFile();
const scratch = mkdtempSync(join(tmpdir(), "ac-arc-import-"));
const data = dataDir ?? join(scratch, "data");
const rep = reporter(join(scratch, "arc-import-e2e.log"), { name: "arc-import-e2e" });
let app = null;
const check = (name, ok, detail = "") => rep.record(name, ok ? { evidence: detail || undefined } : { error: new Error(detail || "failed") });

try {
  app = await launch(appPath, {
    data, fresh: true, onboarded: true,
    session: session({ profiles: ["Personal"], windows: [{ id: "w1" }], tabs: [{ id: "t0", windowId: "w1", url: "", title: "" }] }),
  });
  // Hermes's Function() has no async/await, so the body chains promises.
  const result = await app.eval(`
    const api = ac.importApi;
    if (!api) return { error: "no import module" };
    return api.listBrowsers().then((sources) => {
      const arc = sources.find((s) => s.id === "arc" || s.family === "arc");
      if (!arc) return { error: "Arc not discovered", sources: sources.map((s) => s.id) };
      const profile = arc.profiles[0];
      return api.importData(arc.id, profile.id, ["spaces", "pinnedTabs", "tabs"], {}).then((imported) => {
        const store = ac.store.getState();
        const out = [];
        let index = 0;
        for (const space of imported.spaces) {
          const name = space.name || "Space";
          const dest = index++ === 0 ? store.profileOrder[0] : ac.store.getState().createProfile({ name, color: ac.themes.profileColorFor(space.color), icon: space.emoji || null });
          const r = ac.themes.importArcSpace(dest, space, name);
          const s = ac.store.getState();
          const tabs = Object.values(s.tabs).filter((t) => t.profileId === dest && t.url);
          const groups = Object.values(s.groups).filter((g) => g.profileId === dest);
          const grouped = new Set(groups.flatMap((g) => g.tabIds));
          out.push({
            name, imported: r.tabs, profile: dest, parsed: { pinned: space.pinned.length, tabs: space.tabs.length, groups: (space.groups || []).length },
            pinnedRows: tabs.filter((t) => t.pinned).length,
            groups: groups.map((g) => ({ name: g.name, pinned: g.pinned, tabs: g.tabIds.length })),
            loose: tabs.filter((t) => !t.pinned && !grouped.has(t.id)).length,
            total: tabs.length,
          });
        }
        return { spaces: out, favorites: imported.favorites.length, warnings: imported.warnings };
      });
    });
  `, { timeout: 60000 });

  if (result.error) {
    check("import ran", false, JSON.stringify(result));
  } else {
    check("import ran", true, `${result.spaces.length} spaces, ${result.favorites} favorites`);
    for (const exp of expected) {
      const got = result.spaces.find((s) => s.name === exp.name);
      check(`${exp.name}: space imported`, !!got);
      if (!got) continue;
      const want = [...exp.pinnedFolders, ...exp.todayFolders].map((f) => `${f.name}(${f.tabs})${f.pinned ? " pinned" : ""}`).sort();
      const have = got.groups.filter((g) => g.name !== "Imported").map((g) => `${g.name}(${g.tabs})${g.pinned ? " pinned" : ""}`).sort();
      check(`${exp.name}: folders are groups`, JSON.stringify(want) === JSON.stringify(have), `want ${want.join(", ") || "none"}; have ${have.join(", ") || "none"}`);
      check(`${exp.name}: pinned rows`, got.pinnedRows === exp.pinnedRows, `want ${exp.pinnedRows}, have ${got.pinnedRows}`);
      const imp = got.groups.find((g) => g.name === "Imported");
      check(`${exp.name}: loose Today tabs in Imported`, (imp?.tabs ?? 0) + got.loose === exp.todayLoose, `want ${exp.todayLoose}, have ${(imp?.tabs ?? 0)} in Imported + ${got.loose} loose`);
      const expectedTotal = exp.pinnedRows + exp.todayLoose + [...exp.pinnedFolders, ...exp.todayFolders].reduce((n, f) => n + f.tabs, 0);
      check(`${exp.name}: no tab lost`, got.total === expectedTotal, `want ${expectedTotal}, have ${got.total}`);
    }
    rep.log(JSON.stringify(result, null, 1));
  }
} catch (e) {
  check("run", false, String(e?.stack ?? e));
} finally {
  await app?.quit();
}
const ok = rep.summary();
if (ok && !dataDir) rmSync(scratch, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
