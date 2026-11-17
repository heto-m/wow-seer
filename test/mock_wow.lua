local ADDONS, OUT, SECONDS = arg[1], arg[2], tonumber(arg[3])

local now, frames, timers, shots = 100, {}, {}, 0
local pendingEvents = {}

local function Object()
	return setmetatable({}, { __index = function() return function() end end })
end

local function NewTexture(parent)
	local t = Object()
	t.parent = parent
	function t:SetPoint(_, _, _, x, y) rawset(self, "x", x); rawset(self, "y", -y) end
	function t:SetSize(w) rawset(self, "w", w) end
	function t:SetColorTexture(r, g, b) rawset(self, "r", r); rawset(self, "g", g); rawset(self, "b", b) end
	function t:Show() rawset(self, "shown", true) end
	function t:Hide() rawset(self, "shown", false) end
	parent.textures[#parent.textures + 1] = t
	return t
end

function CreateFrame()
	local f = Object()
	f.textures, f.scripts, f.events, f.shown = {}, {}, {}, true
	function f:CreateTexture() return NewTexture(self) end
	function f:SetScript(k, fn) self.scripts[k] = fn end
	function f:RegisterEvent(e) self.events[e] = true end
	function f:Show() self.shown = true end
	function f:Hide() self.shown = false end
	function f:IsShown() return self.shown end
	function f:IsVisible() return self.shown end
	function f:SetShown(v) self.shown = v end
	frames[#frames + 1] = f
	return f
end

local function Fire(event, ...)
	for _, f in ipairs(frames) do
		if f.events[event] and f.scripts.OnEvent then f.scripts.OnEvent(f, event, ...) end
	end
end

function Screenshot()
	shots = shots + 1
	local out = io.open(string.format("%s/shot%03d.txt", OUT, shots), "w")
	for _, f in ipairs(frames) do
		if f.shown then
			for _, t in ipairs(f.textures) do
				if rawget(t, "shown") and rawget(t, "w") then
					out:write(string.format("%g %g %g %.6f %.6f %.6f\n", t.x, t.y, t.w, t.r, t.g, t.b))
				end
			end
		end
	end
	out:close()
	pendingEvents[#pendingEvents + 1] = { at = now + 0.4, event = "SCREENSHOT_SUCCEEDED" }
end

C_Timer = {
	After = function(d, fn) timers[#timers + 1] = { at = now + d, fn = fn } end,
	NewTicker = function(d, fn) timers[#timers + 1] = { at = now + d, fn = fn, every = d } end,
}
function GetTime() return now end
GetTimePreciseSec = GetTime
function debugprofilestop() return now * 1000 end
function InCombatLockdown() return false end
local cvars = { screenshotFormat = os.getenv("MOCK_FORMAT") or "png" }
function GetCVar(name) return cvars[name] end
function SetCVar(name, value) cvars[name] = value end
function StaticPopup_Show(name, arg) print("popup " .. name .. " " .. tostring(arg)) end
function GetPhysicalScreenSize() return 1100, 700 end
function GetBuildInfo() return "1.60.1", "70938", "Nov 12 2026", 16001 end
function GetLocale() return "esES" end
function UnitName() return "Testera" end
function GetRealmName() return "Peus" end
function UnitLevel() return 23 end
function UnitClass() return "Sacerdote", "PRIEST" end
function UnitRace() return "No-muerto", "Scourge" end
function UnitSex() return 2 end
function GetMoney() return 123456 end
function UnitStat(_, i) return 10 + i, 20 + i end
function GetInventoryItemID(_, slot) if slot == 1 then return 7048 end end
function GetInventoryItemLink() return "|cff1eff00|Hitem:7048::::::::23:::::|h[Capucha azul]|h|r" end
function GetInventoryItemQuality() return 2 end
function GetTalentInfo(tab, i) return "Talento " .. tab .. "." .. i, nil, 1, i, 0, 5 end
function GetNumTalentTabs() return 3 end
function GetNumTalents() return 2 end
function GetTalentTabInfo(tab) return "Rama " .. tab end
date = os.date
time = os.time
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
UIParent = CreateFrame()
WorldFrame = CreateFrame()
SlashCmdList = {}
StaticPopupDialogs = {}
C_TooltipInfo = {
	GetInventoryItem = function() return { lines = { { leftText = "Capucha azul" }, { leftText = "Cabeza", rightText = "Tela" }, { leftText = "|cff00ff00+5 Intelecto|r" } } } end,
	GetBagItem = function()
		local lines = { { leftText = "Varita" } }
		if os.getenv("MOCK_BIG") then
			math.randomseed(7)
			for _ = 1, 400 do
				lines[#lines + 1] = { leftText = string.format("%08x%08x%08x", math.random(0, 2 ^ 30), math.random(0, 2 ^ 30), math.random(0, 2 ^ 30)) }
			end
		end
		return { lines = lines }
	end,
	GetItemByID = function(id) return { lines = { { leftText = "Objeto " .. id } } } end,
}
C_Item = {
	GetItemNameByID = function(id) return "Objeto " .. id end,
	IsEquippableItem = function(id) return id == 5240 end,
	GetItemInfoInstant = function(id)
		return id, "Arma", "Varita", id == 5240 and "INVTYPE_RANGEDRIGHT" or "", 135139, 2, 19
	end,
}
C_Container = {
	GetContainerNumSlots = function(bag) return bag == 0 and 16 or 0 end,
	GetContainerItemInfo = function(bag, slot)
		if bag == 0 and slot <= 3 then
			local id = ({ 2589, 5240, 159 })[slot]
			return { itemID = id, stackCount = slot * 5, quality = 1, hyperlink = "|Hitem:" .. id .. "|h[Cosa ñ " .. id .. "]|h" }
		end
	end,
}
C_QuestLog = {
	GetNumQuestLogEntries = function() return 2 end,
	GetInfo = function(i)
		if i == 1 then return { isHeader = true, title = "Tirisfal" } end
		return { title = "Ratas", questID = 99, level = 5 }
	end,
	GetQuestObjectives = function() return { { text = "Ratas: 3/10", finished = false, numFulfilled = 3, numRequired = 10 } } end,
	IsComplete = function() return false end,
}

local addonList = {}
local list = package.config:sub(1, 1) == "\\" and 'dir /b "' or 'ls "'
for line in io.popen(list .. ADDONS .. '"'):lines() do addonList[#addonList + 1] = line end
C_AddOns = {
	GetNumAddOns = function() return #addonList end,
	GetAddOnInfo = function(i) return addonList[i] end,
	GetAddOnMetadata = function(name, field)
		local toc = io.open(ADDONS .. "/" .. name .. "/" .. name .. ".toc")
		if not toc then return nil end
		local text = toc:read("*a")
		toc:close()
		return text:match("## " .. field .. ":%s*([^\r\n]+)")
	end,
	EnableAddOn = function() end,
	LoadAddOn = function(name)
		local fn = assert(loadfile(ADDONS .. "/" .. name .. "/body.lua"))
		fn()
		return true
	end,
}

local ns = {}
for line in io.lines(ADDONS .. "/Seer/Seer.toc") do
	local file = line:match("^([%w_]+%.lua)%s*$")
	if file then assert(loadfile(ADDONS .. "/Seer/" .. file))("Seer", ns) end
end
if os.getenv("MOCK_LOCALES") then
	local function specs(s)
		local out = {}
		for p in s:gmatch("%%[%.%d]*%a") do out[#out + 1] = p end
		return table.concat(out, " ")
	end
	for locale, t in pairs(ns.LOCALES) do
		for key, en in pairs(ns.EN) do
			assert(t[key], locale .. " misses " .. key)
			assert(specs(t[key]) == specs(en), locale .. "." .. key .. " placeholders differ")
		end
		for key in pairs(t) do assert(ns.EN[key], locale .. " has unknown " .. key) end
	end
	print("locales ok")
	os.exit(0)
end
if os.getenv("MOCK_PRICES") then
	C_Item.GetItemInfo = function(id) return "Objeto " .. id, nil, 2, 20, 20, nil, nil, 1, "", 0, id * 10 end
	Auctionator = { API = { v1 = {
		GetAuctionPriceByItemID = function(caller, id) assert(caller == "Seer"); if id == 5240 then return 9000 end end,
		GetAuctionAgeByItemID = function(_, id) if id == 5240 then return 3 end end,
		GetAuctionPriceByItemLink = function(_, link) if link:find("item:2589") then return 40 end end,
		GetAuctionAgeByItemLink = function() return 0 end,
	} } }
	ns.wantedPrices = { items = { 5240, 777 }, bags = true }
	print(ns.ToJson(ns.collect.prices()))
	os.exit(0)
end
Fire("ADDON_LOADED", "Seer")
Fire("PLAYER_LOGIN")
Fire("PLAYER_ENTERING_WORLD")

if os.getenv("MOCK_SEND") then C_Timer.After(10, function() SlashCmdList.SEER("send") end) end

local stop = now + SECONDS
while now < stop do
	now = now + 0.016
	for i = #timers, 1, -1 do
		local t = timers[i]
		if now >= t.at then
			if t.every then t.at = t.at + t.every else table.remove(timers, i) end
			t.fn()
		end
	end
	for i = #pendingEvents, 1, -1 do
		if now >= pendingEvents[i].at then
			local e = table.remove(pendingEvents, i)
			Fire(e.event)
		end
	end
	for _, f in ipairs(frames) do
		if f.shown and f.scripts.OnUpdate then f.scripts.OnUpdate(f, 0.016) end
	end
end
print("shots " .. shots)
