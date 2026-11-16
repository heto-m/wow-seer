local ADDON, ns = ...

local SLOT_FORMAT = "Seer_S%04d"
local POLL_ALIVE, POLL_IDLE = 10, 60
local ALIVE_FOR = 180
local DEBOUNCE, MIN_GAP = 2, 5
local CONFIRM_WITHIN = 45
local ALWAYS = { "player", "equipment", "bags", "quests", "talents", "skills" }
local GetMetadata = C_AddOns and C_AddOns.GetAddOnMetadata or GetAddOnMetadata
local VERSION = GetMetadata and GetMetadata(ADDON, "Version")

ns.wantedItems = {}
local db
local dirty = {}
local acks = {}
local done = {}
local slotCount, nextSlot = 0, 1
local lastPoll, lastPush, serverSeen = -1000, -1000, nil
local msgId = 0
local unconfirmed = {}
local worldReady, loading = false, false
local warned = {}

local function Say(text)
	print("|cff9b7bffSeer|r " .. text)
end

local function Alive()
	return serverSeen ~= nil and GetTime() - serverSeen < ALIVE_FOR
end

local function Mark(section)
	if not dirty[section] then dirty[section] = GetTime() end
end
ns.Mark = Mark

local function MarkAll()
	for _, s in ipairs(ALWAYS) do Mark(s) end
end

local function Collect(section)
	local fn = ns.collect[section]
	local ok, data = pcall(fn)
	if not ok then return { error = tostring(data) } end
	return data
end

local function CountSlots()
	local n = 0
	for i = 1, C_AddOns.GetNumAddOns() do
		local index = tonumber((C_AddOns.GetAddOnInfo(i) or ""):match("^Seer_S(%d%d%d%d)$"))
		if index and index > n then n = index end
	end
	return n
end

local function HandleRequest(req)
	if type(req) ~= "table" or type(req.id) ~= "number" or req.id >= 2 ^ 31 or done[req.id] then return end
	done[req.id] = true
	acks[#acks + 1] = req.id
	if req.kind == "refresh" then
		for _, s in ipairs(type(req.sections) == "table" and req.sections or ALWAYS) do
			if ns.collect[s] then dirty[s] = -1000 end
		end
	elseif req.kind == "item" and type(req.item) == "number" then
		ns.wantedItems[req.item] = true
		dirty.items = -1000
	elseif req.kind == "config" and type(req.cell) == "number" and req.cell >= 1 and req.cell <= 4 then
		ns.Strip.cell = req.cell
		db.cell = req.cell
		Say("Server set the strip cell size to " .. req.cell .. " px.")
	end
	if #acks > 0 then dirty.acks = dirty.acks or -1000 end
end

local function Poll()
	lastPoll = GetTime()
	if nextSlot > slotCount then
		if not warned.slots then
			warned.slots = true
			Say("All request slots are used. Type /reload to renew them. Changes are still sent.")
		end
		return
	end
	local name = string.format(SLOT_FORMAT, nextSlot)
	nextSlot = nextSlot + 1
	SeerInbox = nil
	pcall(C_AddOns.EnableAddOn, name)
	local ok = pcall(C_AddOns.LoadAddOn, name)
	local inbox = SeerInbox
	SeerInbox = nil
	if not ok or type(inbox) ~= "table" or type(inbox.t) ~= "number" then return end
	if math.abs(time() - inbox.t) < ALIVE_FOR then
		if not Alive() then MarkAll() end
		serverSeen = GetTime()
	end
	for _, id in ipairs(type(inbox.got) == "table" and inbox.got or {}) do unconfirmed[id] = nil end
	for _, req in ipairs(type(inbox.reqs) == "table" and inbox.reqs or {}) do HandleRequest(req) end
end

local function ResendLost()
	local now = GetTime()
	for id, sent in pairs(unconfirmed) do
		if now - sent.at > CONFIRM_WITHIN then
			unconfirmed[id] = nil
			for _, s in ipairs(sent.sections) do Mark(s) end
		end
	end
end

local function Ready(now)
	local list = {}
	for section, since in pairs(dirty) do
		if section ~= "acks" and now - since >= DEBOUNCE then list[#list + 1] = section end
	end
	return list
end

local function Push(force)
	local now = GetTime()
	if ns.Strip.Busy() or InCombatLockdown() or not worldReady then return end
	if not force and (not Alive() or db.paused or now - lastPush < MIN_GAP) then return end
	local list = Ready(now)
	if #list == 0 and not dirty.acks then return end
	local sections = {}
	for _, s in ipairs(list) do
		local data = Collect(s)
		if data ~= nil then
			sections[s] = data
			db.saved[s] = ns.ToJson(data)
		end
	end
	msgId = (db.msgId or 0) % 65535 + 1
	db.msgId = msgId
	local sent = acks
	acks = {}
	local text = ns.ToJson({
		seer = 1, msg = msgId, t = time(), slot = nextSlot, slots = slotCount,
		build = (GetBuildInfo()), version = VERSION, acks = sent, sections = sections,
	})
	local started = GetTime()
	for _, s in ipairs(list) do dirty[s] = nil end
	dirty.acks = nil
	lastPush = now
	local ok = ns.Strip.Send(msgId, text, function(success, why)
		if success then
			ns.lastSent = { bytes = #text, at = GetTime(), sections = list }
			unconfirmed[msgId] = { at = GetTime(), sections = list }
			if sections.items then wipe(ns.wantedItems) end
			return
		end
		for _, s in ipairs(list) do
			if not dirty[s] then dirty[s] = started end
		end
		for _, id in ipairs(sent) do acks[#acks + 1] = id end
		if why ~= "combat" and not warned[why] then
			warned[why] = true
			Say("Sending failed: " .. tostring(why))
		end
	end)
	if not ok then
		for _, s in ipairs(list) do dirty[s] = started end
		for _, id in ipairs(sent) do acks[#acks + 1] = id end
	end
end

local function Tick()
	local ok, err = pcall(function()
		local interval = Alive() and POLL_ALIVE or POLL_IDLE
		if GetTime() - lastPoll >= interval and not InCombatLockdown() then
			Poll()
			ResendLost()
		end
		Push(false)
	end)
	if not ok and not warned.tick then
		warned.tick = true
		Say("|cffff4040error|r " .. tostring(err))
	end
end

local EVENTS = {
	BAG_UPDATE_DELAYED = { "bags" },
	PLAYER_EQUIPMENT_CHANGED = { "equipment", "bags", "player" },
	PLAYER_MONEY = { "player" },
	PLAYER_LEVEL_UP = { "player", "talents" },
	ZONE_CHANGED_NEW_AREA = { "player" },
	QUEST_LOG_UPDATE = { "quests" },
	CHARACTER_POINTS_CHANGED = { "talents" },
	TRAIT_CONFIG_UPDATED = { "talents" },
	TRAIT_NODE_CHANGED = { "talents" },
	ACTIVE_TALENT_GROUP_CHANGED = { "talents" },
	SKILL_LINES_CHANGED = { "skills" },
	TRAINER_UPDATE = { "trainer" },
	TRADE_SKILL_LIST_UPDATE = { "profession" },
	MERCHANT_UPDATE = { "merchant" },
	PLAYERBANKSLOTS_CHANGED = { "bank" },
}

local OPEN = {
	BANKFRAME_OPENED = { "bankOpen", true, "bank" },
	BANKFRAME_CLOSED = { "bankOpen", false },
	TRAINER_SHOW = { "trainerOpen", true, "trainer" },
	TRAINER_CLOSED = { "trainerOpen", false },
	TRADE_SKILL_SHOW = { "professionOpen", true, "profession" },
	TRADE_SKILL_CLOSE = { "professionOpen", false },
	MERCHANT_SHOW = { "merchantOpen", true, "merchant" },
	MERCHANT_CLOSED = { "merchantOpen", false },
}

local function OnAuction(event, arg)
	if event == "GET_ITEM_INFO_RECEIVED" or event == "ITEM_KEY_ITEM_INFO_RECEIVED" then
		if ns.auctionMissingNames and ns.auction and ns.auction.browse then
			ns.auction.browse = ns.AuctionBrowse()
			Mark("auction")
		end
		return
	end
	local a = ns.auction or {}
	if event == "AUCTION_HOUSE_BROWSE_RESULTS_UPDATED" then
		a.browse = ns.AuctionBrowse()
	elseif event == "COMMODITY_SEARCH_RESULTS_UPDATED" then
		a.search = ns.AuctionCommodity(arg)
	elseif event == "ITEM_SEARCH_RESULTS_UPDATED" then
		a.search = ns.AuctionItem(arg)
	end
	a.at = time()
	ns.auction = a
	Mark("auction")
end

local events = CreateFrame("Frame")
events:SetScript("OnEvent", function(_, event, arg1)
	local ok, err = pcall(function()
		if event == "ADDON_LOADED" then
			if arg1 ~= ADDON then return end
			SeerDB = SeerDB or {}
			db = SeerDB
			db.saved = db.saved or {}
			ns.Strip.cell = db.cell or 1
			ns.debug = db.debug
			ns.Strip.rows = db.rows or ns.Strip.rows
			ns.Strip.pre = db.pre or ns.Strip.pre
		elseif event == "PLAYER_LOGIN" then
			slotCount = CountSlots()
			C_Timer.NewTicker(1, Tick)
		elseif event == "PLAYER_ENTERING_WORLD" then
			for _, s in ipairs(ALWAYS) do Mark(s) end
			C_Timer.After(8, function() if not loading then worldReady = true end end)
		elseif event == "LOADING_SCREEN_ENABLED" then
			worldReady, loading = false, true
		elseif event == "LOADING_SCREEN_DISABLED" then
			loading = false
			C_Timer.After(1, function() if not loading then worldReady = true end end)
		elseif event == "PLAYER_LOGOUT" then
			for _, s in ipairs(ALWAYS) do
				local data = Collect(s)
				if data then db.saved[s] = ns.ToJson(data) end
			end
			db.savedAt = time()
		elseif event == "SCREENSHOT_SUCCEEDED" or event == "SCREENSHOT_FAILED" then
			ns.Strip.OnScreenshot(event == "SCREENSHOT_SUCCEEDED")
		elseif event == "ADDON_ACTION_BLOCKED" or event == "ADDON_ACTION_FORBIDDEN" then
			if arg1 == ADDON and not warned.blocked then
				warned.blocked = true
				Say(event .. ". Please report this.")
			end
		elseif OPEN[event] then
			local o = OPEN[event]
			ns[o[1]] = o[2]
			if o[3] then Mark(o[3]) end
		elseif EVENTS[event] then
			for _, s in ipairs(EVENTS[event]) do Mark(s) end
		else
			OnAuction(event, arg1)
		end
	end)
	if not ok and not warned[event] then
		warned[event] = true
		Say("|cffff4040error|r in " .. event .. ": " .. tostring(err))
	end
end)

for _, e in ipairs({ "ADDON_LOADED", "PLAYER_LOGIN", "PLAYER_ENTERING_WORLD", "PLAYER_LOGOUT",
	"SCREENSHOT_SUCCEEDED", "SCREENSHOT_FAILED", "LOADING_SCREEN_ENABLED", "LOADING_SCREEN_DISABLED", "ADDON_ACTION_BLOCKED", "ADDON_ACTION_FORBIDDEN",
	"AUCTION_HOUSE_BROWSE_RESULTS_UPDATED", "COMMODITY_SEARCH_RESULTS_UPDATED", "ITEM_SEARCH_RESULTS_UPDATED",
	"GET_ITEM_INFO_RECEIVED", "ITEM_KEY_ITEM_INFO_RECEIVED" }) do
	pcall(events.RegisterEvent, events, e)
end
for e in pairs(EVENTS) do pcall(events.RegisterEvent, events, e) end
for e in pairs(OPEN) do pcall(events.RegisterEvent, events, e) end

local function Test()
	for _, s in ipairs(ns.SECTIONS) do
		local ok, data = pcall(ns.collect[s])
		if not ok then
			Say(s .. ": |cffff4040error|r " .. tostring(data))
		elseif data == nil then
			Say(s .. ": nothing (window closed)")
		else
			local okJson, text = pcall(ns.ToJson, data)
			Say(s .. ": " .. (okJson and (#text .. " bytes: " .. text:sub(1, 90)) or ("|cffff4040json error|r " .. tostring(text))))
		end
	end
	Say(string.format("Strip: %d columns, %d bytes per screenshot, cell %d px.",
		ns.Strip.Columns(), ns.Strip.Capacity(), ns.Strip.cell))
end

local function Status()
	Say(string.format("server %s, slots %d of %d used, %s.",
		Alive() and "connected" or "not seen", nextSlot - 1, slotCount, db.paused and "paused" or "sending changes"))
	if ns.lastSent then
		Say(string.format("last sent %d bytes %.0f s ago: %s", ns.lastSent.bytes, GetTime() - ns.lastSent.at,
			table.concat(ns.lastSent.sections, ", ")))
	end
end

SLASH_SEER1 = "/seer"
SlashCmdList.SEER = function(msg)
	local ok, err = pcall(function()
		local cmd, arg = strtrim(msg or ""):lower():match("^(%S*)%s*(.-)$")
		if cmd == "test" then
			Test()
		elseif cmd == "send" then
			MarkAll()
			for s in pairs(dirty) do dirty[s] = -1000 end
			Push(true)
		elseif cmd == "debug" then
			ns.debug = not ns.debug
			db.debug = ns.debug
			Say("Debug " .. (ns.debug and "on" or "off") .. string.format(". worldReady %s, alive %s.", tostring(worldReady), tostring(Alive())))
		elseif cmd == "pause" then
			db.paused = true
			Say("Paused. Requests from the server still work.")
		elseif cmd == "resume" then
			db.paused = false
			Say("Sending changes again.")
		elseif (cmd == "rows" or cmd == "pre") and tonumber(arg) then
			local v = math.max(1, math.min(16, math.floor(tonumber(arg))))
			ns.Strip[cmd] = v
			db[cmd] = v
			Say(string.format("%s = %d (%d bytes per screenshot)", cmd, v, ns.Strip.Capacity()))
		elseif cmd == "cell" and tonumber(arg) then
			ns.Strip.cell = math.max(1, math.min(4, tonumber(arg)))
			db.cell = ns.Strip.cell
			Say("Cell size " .. ns.Strip.cell .. " px.")
		else
			Status()
			Say("/seer status | test | send | pause | resume | cell <1-4>")
		end
	end)
	if not ok then Say("|cffff4040error|r " .. tostring(err)) end
end
