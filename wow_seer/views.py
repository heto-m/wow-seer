import re
import unicodedata

SOULBOUND = {"Soulbound", "Ligado", "Lié", "Seelengebunden", "Vincolato", "Vinculado"}
SET_HEADER = re.compile(r"^(.+) \((\d+/\d+)\)$")
DURABILITY = re.compile(r"^\D+ (\d+) / (\d+)$")
SIMPLE_STAT = re.compile(r"^\+?(-?\d+) ([^\d\t:]+)$")
PLURAL = re.compile(r"\|4([^:;]*):([^;]*);")

LOC_SLOTS = {
    "INVTYPE_HEAD": ["head"], "INVTYPE_NECK": ["neck"], "INVTYPE_SHOULDER": ["shoulder"],
    "INVTYPE_BODY": ["shirt"], "INVTYPE_CHEST": ["chest"], "INVTYPE_ROBE": ["chest"],
    "INVTYPE_WAIST": ["waist"], "INVTYPE_LEGS": ["legs"], "INVTYPE_FEET": ["feet"], "INVTYPE_WRIST": ["wrist"],
    "INVTYPE_HAND": ["hands"], "INVTYPE_FINGER": ["finger1", "finger2"],
    "INVTYPE_TRINKET": ["trinket1", "trinket2"], "INVTYPE_CLOAK": ["back"],
    "INVTYPE_WEAPON": ["mainhand", "offhand"], "INVTYPE_2HWEAPON": ["mainhand", "offhand"],
    "INVTYPE_WEAPONMAINHAND": ["mainhand"], "INVTYPE_WEAPONOFFHAND": ["offhand"],
    "INVTYPE_SHIELD": ["offhand"], "INVTYPE_HOLDABLE": ["offhand"], "INVTYPE_RANGED": ["ranged"],
    "INVTYPE_RANGEDRIGHT": ["ranged"], "INVTYPE_THROWN": ["ranged"], "INVTYPE_RELIC": ["ranged"],
    "INVTYPE_TABARD": ["tabard"],
}
SLOTS = ["head", "neck", "shoulder", "shirt", "chest", "waist", "legs", "feet", "wrist", "hands",
         "finger1", "finger2", "trinket1", "trinket2", "back", "mainhand", "offhand", "ranged", "tabard"]


def fold(text):
    text = unicodedata.normalize("NFKD", str(text).lower())
    return "".join(c for c in text if not unicodedata.combining(c))


def matches(query, *texts):
    q = fold(query)
    return any(q in fold(t) for t in texts if t)


def table(items, cols):
    used = [c for c in cols if any(i.get(c) is not None and i.get(c) is not False and i.get(c) != "" for i in items)]
    return {"cols": used, "rows": [[i.get(c) for c in used] for i in items]}


def tidy_tooltip(lines, name=None):
    lines = [PLURAL.sub(r"\2", l) for l in (lines or [])]
    if lines and lines[0] == name:
        lines = lines[1:]
    out, set_info, durability, i = [], None, None, 0
    while i < len(lines):
        line = lines[i]
        header = SET_HEADER.match(line)
        if header and i + 1 < len(lines) and lines[i + 1].startswith("  "):
            pieces, bonuses = [], []
            i += 1
            while i < len(lines) and lines[i].startswith("  "):
                pieces.append(lines[i].strip())
                i += 1
            while i < len(lines) and not lines[i].strip():
                i += 1
            while i < len(lines) and lines[i].strip() and not DURABILITY.match(lines[i]):
                bonuses.append(lines[i])
                i += 1
            set_info = {"name": header.group(1), "have": header.group(2), "pieces": pieces, "bonuses": bonuses}
            continue
        i += 1
        dur = DURABILITY.match(line)
        if dur:
            if int(dur.group(1)) < int(dur.group(2)):
                durability = "%s/%s" % dur.groups()
            continue
        if line.strip() and line not in SOULBOUND:
            out.append(line)
    return out, set_info, durability


def item_view(item, keys=("slot", "id", "name", "quality"), sets=None, tooltip=True):
    out = {k: item[k] for k in keys if item.get(k) is not None}
    lines, set_info, durability = tidy_tooltip(item.get("tooltip"), item.get("name"))
    if tooltip:
        out["tooltip"] = lines
    if durability:
        out["durability"] = durability
    if set_info:
        if sets is None:
            out["set"] = set_info
        else:
            out["set"] = set_info["name"]
            sets.setdefault(set_info["name"], {k: v for k, v in set_info.items() if k != "name"})
    return out


def simple_stats(lines):
    stats = {}
    for line in lines:
        m = SIMPLE_STAT.match(line.strip())
        if m:
            stats[m.group(2).strip()] = stats.get(m.group(2).strip(), 0) + int(m.group(1))
    return stats


def stat_diff(new, old):
    a, b = simple_stats(new), simple_stats(old)
    return {k: a.get(k, 0) - b.get(k, 0) for k in sorted(set(a) | set(b)) if a.get(k, 0) != b.get(k, 0)}


def _round(v):
    return round(v, 1) if isinstance(v, float) else v


def player(p):
    if not p:
        return None
    out = {"name": p.get("name"), "realm": p.get("realm"), "level": p.get("level"),
           "class": "%s (%s)" % (p.get("classLocal"), p.get("class")),
           "race": "%s (%s)" % (p.get("raceLocal"), p.get("race")), "money": p.get("money"),
           "zone": " - ".join(z for z in (p.get("zone"), p.get("subzone")) if z),
           "health": p.get("healthMax"), "armor": p.get("armor")}
    if p.get("xpMax"):
        out["xp"] = "%s/%s" % (p.get("xp"), p.get("xpMax"))
    if p.get("restedXp"):
        out["rested_xp"] = p["restedXp"]
    if p.get("powerType"):
        out[str(p["powerType"]).lower()] = p.get("powerMax")
    out["stats"] = {k: _round(v) for k, v in (p.get("stats") or {}).items() if v is not None}
    return {k: v for k, v in out.items() if v is not None}


def equipment(items, slots=None, detail="full"):
    items = [i for i in (items or []) if not slots or i.get("slot") in slots]
    if detail == "summary":
        rows = [item_view(i, tooltip=False) for i in items]
        for r in rows:
            r.pop("set", None)
        return table(rows, ["slot", "id", "name", "quality", "durability"])
    sets = {}
    out = {"items": [item_view(i, sets=sets) for i in items]}
    if sets:
        out["sets"] = sets
    return out


def talents(t, everything=False):
    if not t:
        return None
    out = {k: t[k] for k in ("spec", "unspent") if t.get(k) is not None}
    if "talents" in t:
        nodes = sorted(t["talents"], key=lambda n: (n.get("y") or 0, n.get("x") or 0))
        out["spent"] = sum(n.get("rank") or 0 for n in nodes)
        out["talents" if everything else "taken"] = [
            "%s %s/%s" % (n.get("name"), n.get("rank") or 0, n.get("max")) for n in nodes
            if everything or (n.get("rank") or 0) > 0]
        return out
    out["tabs"] = []
    for tab in t.get("tabs") or []:
        info = tab.get("info") or []
        names = [n for n in info if isinstance(n, str)]
        taken = ["%s %s/%s" % (n.get("name"), n.get("rank") or 0, n.get("max")) for n in tab.get("talents") or []
                 if everything or (n.get("rank") or 0) > 0]
        out["tabs"].append({"name": names[0] if names else None, "talents": taken})
    return out


def skills(s):
    if s is None:
        return None
    return ["%s %s/%s%s" % (k.get("name"), k.get("rank"), k.get("max"),
                            " (+%s)" % k["bonus"] if k.get("bonus") else "") for k in s]


def _bag_items(sections, where):
    out = []
    for name in (["bags"] if where == "bags" else ["bank"] if where == "bank" else ["bags", "bank"]):
        for bag in sections.get(name) or []:
            for it in bag.get("items") or []:
                out.append(dict(it, bag=bag.get("bag"), where=name))
    return out


def bags(sections, where="bags", name=None, equippable_only=False, detail="summary"):
    items = _bag_items(sections, where)
    if name:
        items = [i for i in items if matches(name, i.get("name"))]
    if equippable_only:
        items = [i for i in items if i.get("tooltip") or i.get("loc")]
    merged, order = {}, []
    for it in items:
        key = it.get("id")
        if key in merged:
            merged[key]["count"] = (merged[key].get("count") or 1) + (it.get("count") or 1)
        else:
            merged[key] = dict(it)
            order.append(key)
    rows = [merged[k] for k in order]
    out = {"items": table(rows, ["id", "name", "count", "quality", "bound"])}
    if detail == "full":
        tips = {}
        for r in rows:
            if r.get("tooltip"):
                v = item_view(r, keys=())
                tips[str(r["id"])] = v.get("tooltip") if len(v) == 1 else v
        if tips:
            out["tooltips"] = tips
    space = {}
    for section in (["bags", "bank"] if where == "both" else [where]):
        containers = sections.get(section) or []
        if containers:
            total = sum(b.get("size") or 0 for b in containers)
            used = sum(len(b.get("items") or []) for b in containers)
            space[section] = "%d/%d free" % (total - used, total)
    if space:
        out["space"] = space
    return out


def find_item(sections, query):
    by_id = str(query).isdigit()
    hits = []

    def hit(it):
        return it.get("id") == int(query) if by_id else matches(query, it.get("name"))
    for it in sections.get("equipment") or []:
        if hit(it):
            hits.append({"where": "equipped", "slot": it.get("slot"), "id": it.get("id"), "name": it.get("name")})
    for it in _bag_items(sections, "both"):
        if hit(it):
            hits.append({"where": it["where"], "bag": it.get("bag"), "slot": it.get("slot"), "id": it.get("id"),
                         "name": it.get("name"), "count": it.get("count")})
    return table(hits, ["where", "bag", "slot", "id", "name", "count"])


def _objective(o):
    text = o.get("text") or ""
    if o.get("need") and "%s/%s" % (o.get("have"), o.get("need")) not in text:
        text = "%s %s/%s" % (text, o.get("have"), o.get("need"))
    return text + (" [done]" if o.get("done") else "")


def quests(qs, zone=None, unfinished_only=False):
    zones = {}
    for q in qs or []:
        if zone and not matches(zone, q.get("zone"), q.get("title")):
            continue
        if unfinished_only and q.get("complete"):
            continue
        entry = {"id": q.get("id"), "title": q.get("title"), "level": q.get("level")}
        if q.get("complete"):
            entry["complete"] = True
        if q.get("failed"):
            entry["failed"] = True
        entry["objectives"] = [_objective(o) for o in q.get("objectives") or []]
        zones.setdefault(q.get("zone") or "?", []).append(entry)
    return {"zones": zones}


def _group_prices(rows, price_key):
    groups, order = {}, []
    for r in rows:
        key = (r.get(price_key) or None, None if r.get(price_key) else r.get("bid"), r.get("name"))
        if key not in groups:
            groups[key] = {price_key: key[0], "bid": key[1], "name": key[2], "quantity": 0, "auctions": 0}
            order.append(key)
        groups[key]["quantity"] += r.get("quantity") or 1
        groups[key]["auctions"] += 1
    return [groups[k] for k in order]


def auction(a, name=None, type=None, slot=None, min_level=None, max_level=None, max_price=None,
            min_quality=None, limit=25):
    if not a:
        return None
    out = {}
    rows = a.get("browse")
    if rows is not None:
        def keep(r):
            if name and not matches(name, r.get("name")):
                return False
            if type and not matches(type, r.get("type")):
                return False
            if slot and slot not in LOC_SLOTS.get(r.get("loc"), ()):
                return False
            level = r.get("level") or 0
            if (min_level is not None and level < min_level) or (max_level is not None and level > max_level):
                return False
            if max_price is not None and (r.get("minPrice") or 0) > max_price:
                return False
            return min_quality is None or (r.get("quality") or 0) >= min_quality
        found = [r for r in rows if keep(r)]
        out["browse"] = table(found[:limit], ["id", "name", "quality", "level", "type", "itemLevel", "minPrice",
                                              "quantity"])
        if len(found) > limit:
            out["browse"]["more"] = len(found) - limit
    search = a.get("search")
    if search:
        price_key = "unitPrice" if any("unitPrice" in r for r in search.get("rows") or []) else "buyout"
        grouped = _group_prices(search.get("rows") or [], price_key)
        for g in grouped:
            if g["name"] == search.get("name"):
                g["name"] = None
        out["search"] = {"id": search.get("id"), "name": search.get("name"),
                         "prices": table(grouped[:limit], [price_key, "bid", "name", "quantity", "auctions"])}
    return out


def trainer(t, available_only=False, name=None):
    if not t:
        return None
    rows = [s for s in t.get("services") or []
            if (not available_only or s.get("status") == "available") and (not name or matches(name, s.get("name")))]
    return {"npc": t.get("npc"),
            "services": table(rows, ["name", "rank", "status", "cost", "level", "skill", "skillRank"])}


def profession(p, name=None, craftable_only=False):
    if not p:
        return None
    rows = []
    for r in p.get("recipes") or []:
        if name and not matches(name, r.get("name")):
            continue
        if craftable_only and not r.get("canMake"):
            continue
        reagents = ", ".join("%s x%s" % (g.get("name") or g.get("id"), g.get("count"))
                             for g in r.get("reagents") or [])
        rows.append(dict(r, reagents=reagents))
    return {"name": p.get("name"), "level": "%s/%s" % (p.get("level"), p.get("max")),
            "recipes": table(rows, ["id", "name", "difficulty", "canMake", "reagents"])}


def merchant(m, name=None, usable_only=False):
    if not m:
        return None
    rows = []
    for it in m.get("items") or []:
        if (name and not matches(name, it.get("name"))) or (usable_only and it.get("usable") is False):
            continue
        rows.append(dict(it, available=None if it.get("available") == -1 else it.get("available"),
                         unusable=it.get("usable") is False))
    return {"npc": m.get("npc"), "items": table(rows, ["id", "name", "price", "stack", "available", "unusable"])}


def candidate(sections, item_id):
    for it in (sections.get("items") or []) + _bag_items(sections, "both"):
        if it.get("id") == item_id and it.get("tooltip"):
            return it
    return None


def _slot_texts(equipped):
    texts = {}
    for e in equipped:
        lines, _, _ = tidy_tooltip(e.get("tooltip"), e.get("name"))
        if lines:
            texts.setdefault(lines[0].split("\t")[0], []).append(e.get("slot"))
    return texts


def compare(item, equipped_items):
    equipped_items = equipped_items or []
    slots = LOC_SLOTS.get(item.get("loc"))
    if not slots:
        lines, _, _ = tidy_tooltip(item.get("tooltip"), item.get("name"))
        learned = _slot_texts(equipped_items)
        slots = next((learned[l.split("\t")[0]] for l in lines if l.split("\t")[0] in learned), [])
    new = item_view(item, keys=("id", "name", "quality"))
    out = {"item": new, "equipped": []}
    for e in equipped_items:
        if e.get("slot") in slots:
            old = item_view(e)
            old["diff"] = stat_diff(new.get("tooltip") or [], old.get("tooltip") or [])
            out["equipped"].append(old)
    if not slots:
        out["note"] = "could not tell which slot this item goes in"
    elif not out["equipped"]:
        out["note"] = "nothing equipped in %s" % ", ".join(slots)
    return out
