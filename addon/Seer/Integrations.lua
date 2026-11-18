local _, ns = ...

local collect = ns.collect
local MAX_OBJECTIVES = 4
local MAX_DROPPERS = 5
local MAX_SCALES = 3
local TRAINING_AHEAD = 5
local WANTED_TRAINING = {
	available = true, nextLevel = true, missingReqs = true, notLevel = true, missingTalent = true,
	weaponAvailable = true, weaponNextLevel = true,
}

local function Try(fn, ...)
	if not fn then return nil end
	local ok, a, b, c, d, e = pcall(fn, ...)
	if ok then return a, b, c, d, e end
end

local function Clean(text)
	if type(text) ~= "string" then return nil end
	text = text:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("|T.-|t", ""):gsub("|A.-|a", "")
	return text ~= "" and text or nil
end

local function Round(v)
	return type(v) == "number" and math.floor(v * 10 + 0.5) / 10 or nil
end

local function MapName(map)
	local info = map and Try(C_Map.GetMapInfo, map)
	return info and info.name
end

function ns.PlayerPosition()
	local map = Try(C_Map.GetBestMapForUnit, "player")
	local pos = map and Try(C_Map.GetPlayerMapPosition, map, "player")
	if not pos then return nil end
	local x, y = Try(pos.GetXY, pos)
	if not (x and y) then return nil end
	return { map = map, mapName = MapName(map), x = Round(x * 100), y = Round(y * 100) }
end

local function QuestieReady()
	return LibQuestieDB and Questie and Questie.API and Questie.API.isReady
end

local function UiMap(areaId)
	local zones = QuestieLoader and Try(QuestieLoader.ImportModule, QuestieLoader, "ZoneDB")
	return zones and Try(zones.GetUiMapIdByAreaId, zones, areaId)
end

-- Spawn lists are keyed by area; the busiest area wins and its spots are averaged into one point.
local function Place(spawnLists)
	local best, bestArea
	for _, spawns in ipairs(spawnLists) do
		for area, points in pairs(spawns or {}) do
			if type(points) == "table" and (not best or #points > #best) then best, bestArea = points, area end
		end
	end
	if not best then return nil end
	local map = UiMap(bestArea)
	local place = { zone = MapName(map) or Try(C_Map.GetAreaInfo, bestArea), map = map, spots = #best }
	local sx, sy, n = 0, 0, 0
	for _, p in ipairs(best) do
		if type(p[1]) == "number" and p[1] >= 0 then sx, sy, n = sx + p[1], sy + p[2], n + 1 end
	end
	if n > 0 then place.x, place.y = Round(sx / n), Round(sy / n) end
	return place
end

local function NpcPlace(id)
	local place = Place({ LibQuestieDB.Npc.spawns(id) })
	if place then place.name = LibQuestieDB.Npc.name(id) end
	return place
end

local function ObjectPlace(id)
	local place = Place({ LibQuestieDB.Object.spawns(id) })
	if place then place.name, place.object = LibQuestieDB.Object.name(id), true end
	return place
end

local function ItemPlace(id)
	local spawns, droppers = {}, {}
	for i, npc in ipairs(Try(LibQuestieDB.Item.npcDrops, id) or {}) do
		if i > MAX_DROPPERS then break end
		spawns[#spawns + 1] = Try(LibQuestieDB.Npc.spawns, npc)
		droppers[#droppers + 1] = Try(LibQuestieDB.Npc.name, npc)
	end
	for i, obj in ipairs(Try(LibQuestieDB.Item.objectDrops, id) or {}) do
		if i > MAX_DROPPERS then break end
		spawns[#spawns + 1] = Try(LibQuestieDB.Object.spawns, obj)
		droppers[#droppers + 1] = Try(LibQuestieDB.Object.name, obj)
	end
	local place = Place(spawns)
	if place then
		place.name = Try(LibQuestieDB.Item.name, id)
		place.from = droppers
	end
	return place
end

local function Finisher(questId)
	local by = Try(LibQuestieDB.Quest.finishedBy, questId)
	if type(by) ~= "table" then return nil end
	if by[1] and by[1][1] then return Try(NpcPlace, by[1][1]) end
	if by[2] and by[2][1] then return Try(ObjectPlace, by[2][1]) end
end

local function ObjectivePlaces(questId)
	local o = Try(LibQuestieDB.Quest.objectives, questId)
	if type(o) ~= "table" then return nil end
	local out = {}
	local function Add(fn, id)
		if #out >= MAX_OBJECTIVES then return end
		local place = Try(fn, id)
		if place then out[#out + 1] = place end
	end
	for _, m in ipairs(o[1] or {}) do Add(NpcPlace, m[1]) end
	for _, m in ipairs(o[2] or {}) do Add(ObjectPlace, m[1]) end
	for _, m in ipairs(o[3] or {}) do Add(ItemPlace, m[1]) end
	return out[1] and out or nil
end

function ns.QuestPlaces(entry)
	if not QuestieReady() or not entry.id then return end
	entry.finish = Finisher(entry.id)
	if not entry.complete then entry.where = ObjectivePlaces(entry.id) end
end

function ns.PawnInfo(link)
	if not (PawnIsReady and Try(PawnIsReady)) or type(link) ~= "string" then return nil end
	local item = Try(PawnGetItemData, link)
	if not (item and item.Values and item.Values[1]) then return nil end
	local upgrades = {}
	for _, u in ipairs(Try(PawnIsItemAnUpgrade, item) or {}) do
		if u.ScaleName and u.PercentUpgrade then upgrades[u.ScaleName] = math.floor(u.PercentUpgrade * 100 + 0.5) end
	end
	local out = {}
	for i, v in ipairs(item.Values) do
		if i > MAX_SCALES then break end
		out[#out + 1] = { scale = v[4] or v[1], value = Round(v[2]), upgrade = upgrades[v[1]] }
	end
	return out
end

-- Polestar keeps Era-frame points (f == "e"); its own converter gives the live map position.
local function LivePoint(t)
	if type(t) ~= "table" or not t.map or not t.x then return nil end
	local x, y = t.x, t.y
	local compat = Polestar and Polestar.Compat
	if t.f == "e" and compat then
		local cont, wx, wy = Try(compat.MapToWorld, t.map, x, y, "e")
		if cont then
			local lx, ly = Try(compat.WorldToMap, cont, wx, wy, t.map)
			if lx and ly then x, y = lx, ly end
		end
	end
	return { map = t.map, mapName = MapName(t.map), x = Round(x), y = Round(y) }
end

function collect.guide()
	local engine = Polestar and Polestar.Engine
	if not engine then return nil end
	local index = Try(engine.GetStepIndex)
	local view = index and Try(engine.GetStepView, index)
	if type(view) ~= "table" then return nil end
	local guide = Try(engine.GetGuide)
	local done, doneOf = Try(engine.GetProgress)
	local out = {
		guide = guide and guide.id,
		step = engine.StepNumber and Try(engine.StepNumber, index) or index,
		steps = engine.StepTotal and Try(engine.StepTotal) or Try(engine.GetStepCount),
		done = done, doneOf = doneOf,
		title = Clean(view.title), note = Clean(view.note), goals = {},
	}
	for _, g in ipairs(view.goals or {}) do
		local p = g.progress
		out.goals[#out.goals + 1] = {
			kind = g.t, text = Clean(g.text), status = g.status, quest = g.quest, npc = Clean(g.npcName),
			optional = g.optional or nil, progress = p and p.max and (tostring(p.cur or 0) .. "/" .. tostring(p.max)) or nil,
			at = LivePoint(g),
		}
	end
	local wp = Try(engine.GetWaypoint)
	if wp then
		out.waypoint = LivePoint(wp)
		if out.waypoint then out.waypoint.label = Clean(wp.label) end
	end
	return out
end

-- Forever blocks the combat log; its built-in damage meter (what Details shows there) has the fight.
local METERS = { damage = "DamageDone", healing = "HealingDone", taken = "DamageTaken" }

function collect.fight()
	local dm, types = C_DamageMeter, Enum and Enum.DamageMeterType
	local current = Enum and Enum.DamageMeterSessionType and Enum.DamageMeterSessionType.Current
	if not (dm and types and current) then return nil end
	local out, byName = { players = {}, deaths = {} }, {}
	for key, meter in pairs(METERS) do
		local session = types[meter] and Try(dm.GetCombatSessionFromType, current, types[meter])
		if type(session) == "table" then
			out.seconds = out.seconds or Round(session.durationSeconds)
			for _, src in ipairs(session.combatSources or {}) do
				local name = src.name
				if type(name) == "string" and not (issecretvalue and issecretvalue(name)) then
					local p = byName[name]
					if not p then
						p = { name = name, me = src.isLocalPlayer or nil }
						byName[name] = p
						out.players[#out.players + 1] = p
					end
					p[key] = math.floor(src.totalAmount or 0)
				end
			end
		end
	end
	local deaths = types.Deaths and Try(dm.GetCombatSessionFromType, current, types.Deaths)
	for _, src in ipairs(type(deaths) == "table" and deaths.combatSources or {}) do
		if type(src.name) == "string" then out.deaths[#out.deaths + 1] = src.name end
	end
	if not out.seconds and not out.players[1] then return nil end
	return out
end

function collect.training()
	if not (WT_API and Try(WT_API.IsReady)) then return nil end
	local level = UnitLevel("player")
	local out = {}
	for _, s in ipairs(Try(WT_API.GetSpells) or {}) do
		if WANTED_TRAINING[s.status] and (s.level or 0) <= level + TRAINING_AHEAD then
			out[#out + 1] = { name = s.name, rank = s.subText, level = s.level, cost = s.cost, status = s.status }
		end
	end
	table.sort(out, function(a, b) return (a.level or 0) < (b.level or 0) end)
	return out
end

local function BisApi()
	local api = ForeverLevelingBiS_API
	return type(api) == "table" and (api.version or 0) >= 2 and api or nil
end

-- Forever Leveling BiS: how much better an item is than what is worn, for the player's spec and level.
function ns.BisGain(link)
	local api = BisApi()
	if not api or type(link) ~= "string" then return nil end
	local gain = Try(api.GetGain, link)
	return type(gain) == "number" and Round(gain) or nil
end

function ns.BisWeights()
	local api = BisApi()
	if not api then return nil end
	local weights, info = Try(api.GetWeights)
	if type(weights) ~= "table" then return nil end
	local out = { stats = {} }
	for k, v in pairs(weights) do
		if type(v) == "number" and v ~= 0 then out.stats[k] = Round(v) end
	end
	out.spec = Try(api.GetSpec)
	if type(info) == "table" then out.source, out.fromLevel, out.toLevel = info.source, info.fromLevel, info.toLevel end
	return out
end

-- Nova Instance Tracker counts the dungeons entered against Forever's hourly limit.
function ns.DungeonLockout()
	if not (NIT and NIT.getInstanceLockoutInfo and NIT.data) then return nil end
	local hour, day, hourTs = Try(NIT.getInstanceLockoutInfo, NIT)
	if type(hour) ~= "number" then return nil end
	local limit = NIT.hourlyLimit
	local out = { lastHour = hour, limit = limit, last24h = day }
	local now = GetServerTime and GetServerTime() or time()
	if limit and hour >= limit and type(hourTs) == "number" then out.freeIn = math.max(0, 3600 - (now - hourTs)) end
	return out
end

function collect.alts()
	local ds = DataStore
	if type(ds) ~= "table" or not ds.GetCharacters then return nil end
	local chars = Try(ds.GetCharacters, ds)
	if type(chars) ~= "table" then return nil end
	local out = {}
	for name, key in pairs(chars) do
		local c = { name = name, level = Try(ds.GetCharacterLevel, ds, key), money = Try(ds.GetMoney, ds, key) }
		c.class = select(2, Try(ds.GetCharacterClass, ds, key))
		c.zone, c.subzone = Try(ds.GetLocation, ds, key)
		c.restXp = Try(ds.GetRestXP, ds, key)
		local mails = Try(ds.GetNumMails, ds, key)
		if type(mails) == "number" and mails > 0 then
			c.mails = mails
			local soonest
			for i = 1, mails do
				local days = Try(ds.GetMailExpiry, ds, key, i)
				if type(days) == "number" and (not soonest or days < soonest) then soonest = days end
			end
			c.mailExpiresDays = Round(soonest)
		end
		out[#out + 1] = c
	end
	table.sort(out, function(a, b) return (a.level or 0) > (b.level or 0) end)
	return out
end

local function SkillUpApi()
	local api = SkillUpForever and SkillUpForever.API
	return type(api) == "table" and api.version == 1 and api or nil
end

local COINS = { Gold = "g", Silver = "s", Copper = "c" }

local function CoinText(text)
	if type(text) ~= "string" then return text end
	return Clean((text:gsub("|TInterface\\MoneyFrame\\UI%-(%a+)Icon.-|t", function(kind) return COINS[kind] or "" end)))
end

local function Pick(row, keys)
	local out = {}
	for _, k in ipairs(keys) do out[k] = row[k] end
	return out
end

function collect.crafting()
	local api = SkillUpApi()
	local list = api and Try(api.Professions, { steps = 5, recipes = 8 })
	if type(list) ~= "table" then return nil end
	local out = {}
	for _, p in ipairs(list) do
		local entry = { name = p.name, rank = p.rank, maxRank = p.maxRank, steps = {}, recipes = {}, reagents = {} }
		for _, st in ipairs(p.steps or {}) do
			local step = Pick(st, { "kind", "text", "count", "cost" })
			step.detail = CoinText(st.detail)
			entry.steps[#entry.steps + 1] = step
		end
		for _, r in ipairs(p.recipes or {}) do
			entry.recipes[#entry.recipes + 1] = Pick(r, { "name", "count", "fromRank", "toRank", "learned", "color", "cost" })
		end
		for _, r in ipairs(p.reagents or {}) do
			local name = r.itemID and Try(C_Item.GetItemNameByID, r.itemID)
			entry.reagents[#entry.reagents + 1] = { id = r.itemID, name = name, need = r.need, have = r.have, source = r.source }
		end
		out[#out + 1] = entry
	end
	return out
end

function ns.HookAddons(mark)
	local bis = BisApi()
	if bis and bis.OnChanged then
		pcall(bis.OnChanged, function()
			mark("bags")
			mark("player")
		end)
	end
	local skillUp = SkillUpApi()
	if skillUp and skillUp.Subscribe then
		pcall(skillUp.Subscribe, function(changes)
			if type(changes) == "table" and changes.professions then mark("crafting") end
		end)
	end
	if Polestar and Polestar.On then
		for _, msg in ipairs({ "STEP_CHANGED", "STEP_UPDATED", "GUIDE_CHANGED", "WAYPOINT_CHANGED" }) do
			pcall(Polestar.On, msg, function() mark("guide") end)
		end
	end
	if WT_API and WT_API.RegisterCallback then
		for _, event in ipairs({ "Ready", "SpellsChanged", "LevelChanged" }) do
			pcall(WT_API.RegisterCallback, "Seer", event, function() mark("training") end)
		end
	end
	if Questie and Questie.API and Questie.API.RegisterOnReady then
		pcall(Questie.API.RegisterOnReady, function() mark("quests") end)
	end
	-- Pawn finishes loading its scales after login, so gear is valued on a second pass.
	C_Timer.After(15, function()
		mark("bags")
		mark("equipment")
	end)
end
