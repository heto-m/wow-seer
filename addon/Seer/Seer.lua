local ADDON, ns = ...

local SLOT_FORMAT = "Seer_S%04d"
local POLL_ALIVE, POLL_IDLE = 10, 60
local ALIVE_FOR = 180
local DEBOUNCE, MIN_GAP = 2, 5
local CONFIRM_WITHIN = 45
local SHOTS_AFTER_MISS = 120
local ALWAYS = { "player", "equipment", "bags", "quests", "talents", "skills", "guide", "fight", "training", "crafting", "alts" }
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
local L = ns.L

local function Say(text, ...)
	print("|cff9b7bffSeer|r " .. (select("#", ...) > 0 and string.format(text, ...) or text))
end

local function Red(text)
	return "|cffff4040" .. text .. "|r"
end

local function Alive()
	return serverSeen ~= nil and GetTime() - serverSeen < ALIVE_FOR
end

local COMM_PREFIX = "Seer"
local COMM_GAP = 60
local commSent = {}

local function VersionNumbers(v)
	local out = {}
	for n in tostring(v):gmatch("%d+") do out[#out + 1] = tonumber(n) end
	return out
end

local function IsNewer(v, than)
	local a, b = VersionNumbers(v), VersionNumbers(than)
	if #a == 0 or #b == 0 then return false end
	for i = 1, math.max(#a, #b) do
		local x, y = a[i] or 0, b[i] or 0
		if x ~= y then return x > y end
	end
	return false
end

local function NewerVersion(v)
	if warned.update or not VERSION or not IsNewer(v, VERSION) then return end
	warned.update = true
	Say(Red(L.UPDATE_AVAILABLE), v)
end

local function SendVersion(channel)
	if GetTime() - (commSent[channel] or -1000) < COMM_GAP then return end
	commSent[channel] = GetTime()
	pcall(C_ChatInfo.SendAddonMessage, COMM_PREFIX, "v:" .. VERSION, channel)
end

local function ShareVersion()
	if not VERSION or not C_ChatInfo or InCombatLockdown() then return end
	if IsInGuild and IsInGuild() then SendVersion("GUILD") end
	if UnitInBattleground and UnitInBattleground("player") then return end
	if IsInGroup and LE_PARTY_CATEGORY_INSTANCE and IsInGroup(LE_PARTY_CATEGORY_INSTANCE) then
		SendVersion("INSTANCE_CHAT")
	elseif IsInRaid and IsInRaid() then
		SendVersion("RAID")
	elseif IsInGroup and IsInGroup() then
		SendVersion("PARTY")
	end
end

local function OnAddonMessage(prefix, text, sender)
	if prefix ~= COMM_PREFIX or type(text) ~= "string" then return end
	local me = UnitName("player")
	if sender == me or (type(sender) == "string" and sender:match("^([^-]+)") == me) then return end
	local v = text:match("^v:([%d%.]+)$")
	if v then NewerVersion(v) end
end

local GetCVarValue = C_CVar and C_CVar.GetCVar or GetCVar
local SetCVarValue = C_CVar and C_CVar.SetCVar or SetCVar

local function ScreenshotFormat()
	return GetCVarValue and GetCVarValue("screenshotFormat") or "png"
end

local function UsePng()
	SetCVarValue("screenshotFormat", "png")
	Say(L.PNG_NOW)
end

StaticPopupDialogs.SEER_PNG = {
	text = L.PNG_POPUP,
	button1 = L.PNG_USE,
	button2 = L.PNG_LATER,
	OnAccept = UsePng,
	OnCancel = function() Say(L.PNG_WAITING) end,
	timeout = 0,
	whileDead = true,
	hideOnEscape = true,
}

local function PngReady()
	local format = ScreenshotFormat()
	if format == "png" then return true end
	if not warned.png then
		warned.png = true
		StaticPopup_Show("SEER_PNG", format)
	end
	return false
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
	elseif req.kind == "prices" then
		ns.wantedPrices = { items = type(req.items) == "table" and req.items or {}, bags = req.bags == true }
		dirty.prices = -1000
	elseif req.kind == "capture" then
		ns.Strip.capture = req.on == true
		db.capture = ns.Strip.capture
	elseif req.kind == "update" and type(req.version) == "string" then
		NewerVersion(req.version)
	elseif req.kind == "config" and type(req.cell) == "number" and req.cell >= 1 and req.cell <= 4 then
		ns.Strip.cell = req.cell
		db.cell = req.cell
		Say(L.CELL_BY_SERVER, req.cell)
	end
	if #acks > 0 then dirty.acks = dirty.acks or -1000 end
end

local function Poll()
	lastPoll = GetTime()
	if nextSlot > slotCount then
		if not warned.slots then
			warned.slots = true
			Say(slotCount == 0 and L.NO_SLOTS or L.SLOTS_USED)
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
			if sent.captured then ns.Strip.shotsUntil = now + SHOTS_AFTER_MISS end
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

local COMPRESS_FROM = 200

-- "Z" marks raw deflate for the server; JSON never starts with it.
-- Deflate costs the game a few ms even on small text, so captured strips skip it until a message needs a second part.
local function Compress(text, captured)
	local lib = ns.LibDeflate or (LibStub and LibStub("LibDeflate", true))
	local from = captured and ns.Strip.Capacity() or COMPRESS_FROM
	if not lib or #text < from then return text end
	local ok, packed = pcall(lib.CompressDeflate, lib, text, { level = 1 })
	if ok and type(packed) == "string" and #packed + 1 < #text then return "Z" .. packed end
	return text
end

local Clock = debugprofilestop or function() return GetTime() * 1000 end

-- Splices the per-section JSON already kept in db.saved instead of encoding every section twice.
local function Message(envelope, list)
	local parts = {}
	for _, s in ipairs(list) do
		if db.saved[s] then parts[#parts + 1] = ns.ToJson(s) .. ":" .. db.saved[s] end
	end
	return ns.ToJson(envelope):sub(1, -2) .. ',"sections":{' .. table.concat(parts, ",") .. "}}"
end

local function Requeue(list, sent, at)
	for _, s in ipairs(list) do
		if not dirty[s] then dirty[s] = at end
	end
	for _, id in ipairs(sent or {}) do acks[#acks + 1] = id end
end

local function Send(st)
	local cost, list, sections = st.cost, st.list, st.sections
	msgId = (db.msgId or 0) % 65535 + 1
	db.msgId = msgId
	local sent = acks
	acks = {}
	dirty.acks = nil
	local at = Clock()
	local text = Message({
		seer = 1, msg = msgId, t = time(), slot = nextSlot, slots = slotCount,
		build = (GetBuildInfo()), version = VERSION, acks = sent, capture = ns.Strip.capture,
	}, st.sending)
	cost.json = cost.json + Clock() - at
	cost.raw = #text
	at = Clock()
	text = Compress(text, st.captured)
	cost.compress = Clock() - at
	local id = msgId
	local ok = ns.Strip.Send(id, text, function(success, why)
		if success then
			ns.lastSent = { bytes = #text, at = GetTime(), sections = list, cost = cost, strip = ns.Strip.lastStats }
			unconfirmed[id] = { at = GetTime(), sections = list, captured = st.captured }
			if sections.items then wipe(ns.wantedItems) end
			if sections.prices then ns.wantedPrices = nil end
			return
		end
		Requeue(list, sent, st.started)
		if why ~= "combat" and not warned[why] then
			warned[why] = true
			Say(L.SEND_FAILED, tostring(why))
		end
	end)
	if not ok then Requeue(list, sent, st.started) end
end

-- One section per frame, then the message: a full send no longer lands on a single frame.
local stage
local stager = CreateFrame("Frame")
stager:Hide()
stager:SetScript("OnUpdate", function(self)
	local st = stage
	local ok, err = pcall(function()
		if InCombatLockdown() then
			stage = nil
			self:Hide()
			Requeue(st.done, nil, st.started)
			return
		end
		local s = st.list[st.i]
		if not s then
			stage = nil
			self:Hide()
			Send(st)
			return
		end
		st.i = st.i + 1
		dirty[s] = nil
		st.done[#st.done + 1] = s
		local at = Clock()
		local data = Collect(s)
		local took = Clock() - at
		st.cost.collect = st.cost.collect + took
		if took > st.cost.slowest then st.cost.slowest, st.cost.slowestName = took, s end
		if data ~= nil then
			at = Clock()
			st.sections[s] = true
			st.sending[#st.sending + 1] = s
			db.saved[s] = ns.ToJson(data)
			st.cost.json = st.cost.json + Clock() - at
		end
	end)
	if not ok then
		stage = nil
		self:Hide()
		if st then Requeue(st.done, nil, st.started) end
		if not warned.stage then
			warned.stage = true
			Say(Red(L.ERROR) .. " " .. tostring(err))
		end
	end
end)

local function Push(force)
	local now = GetTime()
	if stage or ns.Strip.Busy() or InCombatLockdown() or not worldReady then return end
	if not force and (not Alive() or db.paused or now - lastPush < MIN_GAP) then return end
	local captured = ns.Strip.Capturing()
	if not captured and not PngReady() then return end
	local list = Ready(now)
	if #list == 0 and not dirty.acks then return end
	lastPush = now
	stage = {
		list = list, i = 1, done = {}, sending = {}, sections = {}, started = now, captured = captured,
		cost = { collect = 0, json = 0, slowest = 0 },
	}
	stager:Show()
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
		Say(Red(L.ERROR) .. " " .. tostring(err))
	end
end

local EVENTS = {
	BAG_UPDATE_DELAYED = { "bags" },
	PLAYER_EQUIPMENT_CHANGED = { "equipment", "bags", "player" },
	PLAYER_MONEY = { "player" },
	PLAYER_XP_UPDATE = { "player" },
	UPDATE_INVENTORY_DURABILITY = { "equipment" },
	PLAYER_LEVEL_UP = { "player", "talents" },
	ZONE_CHANGED_NEW_AREA = { "player" },
	ZONE_CHANGED = { "player" },
	PLAYER_REGEN_ENABLED = { "fight" },
	ZONE_CHANGED_INDOORS = { "player" },
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

local browseQueued = false

local function RebuildBrowse()
	browseQueued = false
	local a = ns.auction or {}
	local ok, browse = pcall(ns.AuctionBrowse)
	if not ok then return end
	a.browse, a.at = browse, time()
	ns.auction = a
	Mark("auction")
end

-- A big search fires hundreds of item-info events; rebuilding 500 rows on each one ran past the script time limit.
local function QueueBrowse()
	if browseQueued then return end
	browseQueued = true
	C_Timer.After(0.5, RebuildBrowse)
end

local function OnAuction(event, arg)
	if event == "GET_ITEM_INFO_RECEIVED" or event == "ITEM_KEY_ITEM_INFO_RECEIVED" then
		if ns.auctionMissingNames and ns.auction and ns.auction.browse then QueueBrowse() end
		return
	end
	if event == "AUCTION_HOUSE_BROWSE_RESULTS_UPDATED" or event == "AUCTION_HOUSE_BROWSE_RESULTS_ADDED" then
		QueueBrowse()
		return
	end
	local a = ns.auction or {}
	if event == "COMMODITY_SEARCH_RESULTS_UPDATED" then
		a.search = ns.AuctionCommodity(arg)
	elseif event == "ITEM_SEARCH_RESULTS_UPDATED" then
		a.search = ns.AuctionItem(arg)
	end
	a.at = time()
	ns.auction = a
	Mark("auction")
end

local events = CreateFrame("Frame")
events:SetScript("OnEvent", function(_, event, arg1, arg2, _, arg4)
	local ok, err = pcall(function()
		if event == "ADDON_LOADED" then
			if arg1 ~= ADDON then return end
			SeerDB = SeerDB or {}
			db = SeerDB
			db.saved = db.saved or {}
			ns.Strip.cell = db.cell or 1
			ns.Strip.capture = db.capture == true
			ns.debug = db.debug
			ns.Strip.rows = db.rows or ns.Strip.rows
			ns.Strip.pre = db.pre or ns.Strip.pre
		elseif event == "PLAYER_LOGIN" then
			slotCount = CountSlots()
			C_Timer.NewTicker(1, Tick)
			pcall(ns.HookAddons, Mark)
		elseif event == "PLAYER_ENTERING_WORLD" then
			for _, s in ipairs(ALWAYS) do Mark(s) end
			C_Timer.After(10, ShareVersion)
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
				Say(L.BLOCKED, event .. " " .. tostring(arg2))
			end
		elseif event == "CHAT_MSG_ADDON" then
			OnAddonMessage(arg1, arg2, arg4)
		elseif event == "GROUP_ROSTER_UPDATE" then
			C_Timer.After(5, ShareVersion)
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
		Say(Red(string.format(L.ERROR_IN, event, tostring(err))))
	end
end)

for _, e in ipairs({ "ADDON_LOADED", "PLAYER_LOGIN", "PLAYER_ENTERING_WORLD", "PLAYER_LOGOUT",
	"SCREENSHOT_SUCCEEDED", "SCREENSHOT_FAILED", "LOADING_SCREEN_ENABLED", "LOADING_SCREEN_DISABLED", "ADDON_ACTION_BLOCKED", "ADDON_ACTION_FORBIDDEN",
	"AUCTION_HOUSE_BROWSE_RESULTS_UPDATED", "AUCTION_HOUSE_BROWSE_RESULTS_ADDED", "COMMODITY_SEARCH_RESULTS_UPDATED", "ITEM_SEARCH_RESULTS_UPDATED",
	"GET_ITEM_INFO_RECEIVED", "ITEM_KEY_ITEM_INFO_RECEIVED", "CHAT_MSG_ADDON", "GROUP_ROSTER_UPDATE" }) do
	pcall(events.RegisterEvent, events, e)
end
for e in pairs(EVENTS) do pcall(events.RegisterEvent, events, e) end
if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then pcall(C_ChatInfo.RegisterAddonMessagePrefix, COMM_PREFIX) end
for e in pairs(OPEN) do pcall(events.RegisterEvent, events, e) end

local function Test()
	for _, s in ipairs(ns.SECTIONS) do
		local ok, data = pcall(ns.collect[s])
		if not ok then
			Say(s .. ": " .. Red(L.ERROR) .. " " .. tostring(data))
		elseif data == nil then
			Say(L.TEST_NOTHING, s)
		else
			local okJson, text = pcall(ns.ToJson, data)
			if okJson then
				Say(L.TEST_BYTES, s, #text, text:sub(1, 90))
			else
				Say(Red(string.format(L.TEST_JSON_ERROR, s, tostring(text))))
			end
		end
	end
	Say(L.TEST_STRIP, ns.Strip.Columns(), ns.Strip.Capacity(), ns.Strip.cell)
end

local function Status()
	Say(L.STATUS, Alive() and L.CONNECTED or L.NOT_SEEN, nextSlot - 1, slotCount,
		db.paused and L.PAUSED_STATE or L.SENDING_STATE)
	if ScreenshotFormat() ~= "png" then
		Say(L.PNG_STATUS, ScreenshotFormat())
	end
	if slotCount == 0 then
		Say(L.NO_SLOTS)
	elseif not Alive() then
		Say(L.SETUP_HINT)
	end
	if ns.lastSent then
		Say(L.LAST_SENT, ns.lastSent.bytes, GetTime() - ns.lastSent.at, table.concat(ns.lastSent.sections, ", "))
		local c, st = ns.lastSent.cost, ns.lastSent.strip or {}
		Say(L.COST, c.collect, c.slowestName or "-", c.slowest, c.json, c.compress, c.raw, ns.lastSent.bytes,
			st.build or 0, st.shots or 0, st.hitch or 0, st.usual or 0)
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
		elseif cmd == "png" then
			UsePng()
		elseif cmd == "debug" then
			ns.debug = not ns.debug
			db.debug = ns.debug
			Say(L.DEBUG, ns.debug and L.ON or L.OFF, tostring(worldReady), tostring(Alive()))
		elseif cmd == "pause" then
			db.paused = true
			Say(L.PAUSED)
		elseif cmd == "resume" then
			db.paused = false
			Say(L.RESUMED)
		elseif (cmd == "rows" or cmd == "pre") and tonumber(arg) then
			local v = math.max(1, math.min(16, math.floor(tonumber(arg))))
			ns.Strip[cmd] = v
			db[cmd] = v
			Say(L.SETTING, cmd, v, ns.Strip.Capacity())
		elseif cmd == "cell" and tonumber(arg) then
			ns.Strip.cell = math.max(1, math.min(4, tonumber(arg)))
			db.cell = ns.Strip.cell
			Say(L.CELL, ns.Strip.cell)
		else
			Status()
			Say("/seer status | test | send | png | pause | resume | cell <1-4>")
		end
	end)
	if not ok then Say(Red(L.ERROR) .. " " .. tostring(err)) end
end
