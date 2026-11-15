local BASE = "Interface\\AddOns\\SeerSpike\\"
local SLOTS = 20
local COLS, ROWS = 256, 16
local LCG_M = 2147483647
local SHOT_GAP = 1.2
local HIDE_ON_EVENT = -1
local floor = math.floor

local db
local strip, column, sync, headerCells, tailSync, payload = nil, {}, {}, {}, {}, {}
local queue, shot = {}, nil
local hideStatusUntil = 0
local nextSlot = 1
local probeCalls = 0

local function Say(msg)
	print("|cff9b7bffSeer spike|r " .. msg)
end

local function CVar(name)
	local get = (C_CVar and C_CVar.GetCVar) or GetCVar
	local ok, v = pcall(get, name)
	return ok and v or nil
end

local function SetCVarValue(name, value)
	local set = (C_CVar and C_CVar.SetCVar) or SetCVar
	return pcall(set, name, value)
end

local function Env()
	local cvars = {}
	for _, name in ipairs({ "screenshotFormat", "screenshotQuality", "gxWindow", "gxMaximize",
		"gxWindowedResolution", "gxFullscreenResolution", "renderScale", "useUiScale", "uiScale" }) do
		cvars[name] = CVar(name)
	end
	return {
		time = date("%Y-%m-%d %H:%M:%S"),
		build = { GetBuildInfo() },
		physical = { GetPhysicalScreenSize() },
		ui = { GetScreenWidth(), GetScreenHeight(), UIParent:GetEffectiveScale() },
		cvars = cvars,
	}
end

local function Record(kind, entry)
	entry.time = date("%Y-%m-%d %H:%M:%S")
	table.insert(db[kind], entry)
end

local function Cell(pool, i)
	local t = pool[i]
	if not t then
		t = strip:CreateTexture(nil, "OVERLAY")
		pool[i] = t
	end
	return t
end

local function Place(t, x, y, size, r, g, b)
	t:ClearAllPoints()
	t:SetPoint("TOPLEFT", strip, "TOPLEFT", x, -y)
	t:SetSize(size, size)
	t:SetColorTexture(r, g, b, 1)
	t:Show()
end

local function HidePool(pool, from)
	for i = from, #pool do pool[i]:Hide() end
end

local function EnsureStrip()
	if strip then return end
	strip = CreateFrame("Frame", nil, UIParent)
	strip:SetFrameStrata("TOOLTIP")
	strip:SetFrameLevel(10000)
	strip:SetIgnoreParentScale(true)
	strip:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 0, 0)
	local bg = strip:CreateTexture(nil, "BACKGROUND")
	bg:SetAllPoints()
	bg:SetColorTexture(0, 0, 0, 1)
	strip:Hide()
end

local function HeaderBytes(s)
	local hide = s.hide == HIDE_ON_EVENT and 255 or s.hide
	local b = { 83, 69, 1, s.bits, s.cell, hide, floor(s.seq / 256), s.seq % 256,
		floor(COLS / 256), COLS % 256, ROWS }
	local sum = 0
	for i = 1, #b do sum = sum + b[i] end
	b[12] = sum % 256
	return b
end

local function BuildStrip(s)
	EnsureStrip()
	local _, physH = GetPhysicalScreenSize()
	strip:SetScale(768 / physH)
	local height = 8 + ROWS * s.cell
	local width = math.max(4 + COLS * s.cell, 196)
	strip:SetSize(width, height)

	local nv = math.ceil(height / 4)
	for i = 1, nv do
		local v = (i % 2 == 1) and 1 or 0
		Place(Cell(column, i), 0, (i - 1) * 4, 4, v, v, v)
	end
	HidePool(column, nv + 1)

	for j = 1, 16 do
		local v = (j % 2 == 0) and 1 or 0
		Place(Cell(sync, j), 4 * j, 0, 4, v, v, v)
	end

	local bits = {}
	for _, byte in ipairs(HeaderBytes(s)) do
		for i = 7, 0, -1 do bits[#bits + 1] = floor(byte / 2 ^ i) % 2 end
	end
	for k = 1, #bits / 3 do
		Place(Cell(headerCells, k), 68 + 4 * (k - 1), 0, 4, bits[3 * k - 2], bits[3 * k - 1], bits[3 * k])
	end

	local tail = floor((width - 196) / 4)
	for m = 1, tail do
		local v = (m % 2 == 1) and 1 or 0
		Place(Cell(tailSync, m), 196 + 4 * (m - 1), 0, 4, v, v, v)
	end
	HidePool(tailSync, tail + 1)

	local levels = 2 ^ s.bits
	local top = levels - 1
	local state = (s.seq * 7919 + 17) % LCG_M
	local i = 0
	for r = 0, ROWS - 1 do
		for c = 0, COLS - 1 do
			local v = {}
			for ch = 1, 3 do
				state = (state * 16807) % LCG_M
				v[ch] = (state % levels) / top
			end
			i = i + 1
			Place(Cell(payload, i), 4 + c * s.cell, 8 + r * s.cell, s.cell, v[1], v[2], v[3])
		end
	end
end

local driver = CreateFrame("Frame")
driver:Hide()

local function Now()
	return GetTimePreciseSec()
end

local function HideStrip()
	if strip and strip:IsShown() then
		strip:Hide()
		shot.visibleMs = (Now() - shot.shownAt) * 1000
	end
end

local Start

local function Finish(outcome, err)
	local s = shot
	HideStrip()
	driver:Hide()
	shot = nil
	local hide = s.hide == HIDE_ON_EVENT and "event" or tostring(s.hide)
	Say(string.format("#%d %s: bits %d cell %d hide %s pre %d | call %.2f ms, event %.0f ms, visible %.0f ms, %s frames to event%s",
		s.seq, outcome, s.bits, s.cell, hide, s.pre, s.callMs or -1, s.eventMs or -1, s.visibleMs or -1,
		tostring(s.framesToEvent), err and (" | " .. err) or ""))
	Record("shots", {
		seq = s.seq, outcome = outcome, err = err, bits = s.bits, cell = s.cell, hide = hide, pre = s.pre,
		buildMs = s.buildMs, callMs = s.callMs, eventMs = s.eventMs, visibleMs = s.visibleMs,
		framesToEvent = s.framesToEvent, hiddenAfterFrames = s.hiddenAfterFrames, fps = GetFramerate(),
		format = CVar("screenshotFormat"), blocked = s.blocked,
	})
	if #queue > 0 then
		C_Timer.After(SHOT_GAP, function()
			if not shot and #queue > 0 then Start(table.remove(queue, 1)) end
		end)
	elseif s.sweep then
		Say("Sweep done. Type /reload to save the timings, then run: spike.py decode --last " .. s.sweep)
	end
end

driver:SetScript("OnUpdate", function()
	local s = shot
	if not s then driver:Hide() return end
	s.frames = s.frames + 1
	if not s.takenAt then
		if s.frames <= s.pre then return end
		hideStatusUntil = GetTime() + 3
		s.takenAt = Now()
		local before = debugprofilestop()
		local ok, err = pcall(Screenshot)
		s.callMs = debugprofilestop() - before
		if not ok then
			Finish("error", tostring(err))
			return
		end
		s.frames = 0
		if s.hide == 0 then
			HideStrip()
			s.hiddenAfterFrames = 0
		end
	elseif s.hide > 0 and s.frames == s.hide then
		HideStrip()
		s.hiddenAfterFrames = s.frames
	end
end)

Start = function(s)
	if InCombatLockdown() then
		wipe(queue)
		Say("In combat: shots cancelled.")
		return
	end
	s.seq = db.nextSeq % 65536
	db.nextSeq = db.nextSeq + 1
	s.frames = 0
	local before = debugprofilestop()
	BuildStrip(s)
	s.buildMs = debugprofilestop() - before
	shot = s
	strip:Show()
	s.shownAt = Now()
	driver:Show()
	C_Timer.After(10, function()
		if shot == s then Finish("timeout") end
	end)
end

local function ParseHide(arg)
	if arg == nil or arg == "e" or arg == "event" then return HIDE_ON_EVENT end
	return tonumber(arg)
end

local function Shot(args)
	if shot then Say("A shot is already running.") return end
	local s = {
		bits = tonumber(args[1]) or 1,
		cell = tonumber(args[2]) or 4,
		hide = ParseHide(args[3]),
		pre = tonumber(args[4]) or 1,
	}
	if not s.hide or s.bits < 1 or s.bits > 8 or s.cell < 1 or s.cell > 8 then
		Say("Usage: /seerspike shot <bits 1-8> <cell 1-8> <hide e|0|1|2..> <pre frames>")
		return
	end
	Start(s)
end

local function Sweep()
	if shot or #queue > 0 then Say("Shots are already running.") return end
	for _, bits in ipairs({ 1, 2, 4, 8 }) do
		for _, cell in ipairs({ 4, 2, 1 }) do
			for _, hide in ipairs({ HIDE_ON_EVENT, 0, 1, 2 }) do
				queue[#queue + 1] = { bits = bits, cell = cell, hide = hide, pre = 1 }
			end
		end
	end
	local n = #queue
	queue[n].sweep = n
	Say(string.format("Sweep: %d shots, about %d s. Stay out of combat.", n, floor(n * (SHOT_GAP + 0.5))))
	Start(table.remove(queue, 1))
end

local function Slot(arg)
	local n = tonumber(arg) or nextSlot
	if n < 1 or n > SLOTS then Say("Slots run from 1 to " .. SLOTS .. ".") return end
	nextSlot = n + 1
	local name = string.format("SeerSpike_S%02d", n)
	SeerSpikeInbox = SeerSpikeInbox or {}
	SeerSpikeInbox[name] = nil
	local before = debugprofilestop()
	pcall(C_AddOns.EnableAddOn, name)
	local ok, loaded, reason = pcall(C_AddOns.LoadAddOn, name)
	local ms = debugprofilestop() - before
	if not ok then reason = loaded; loaded = false end
	local text = SeerSpikeInbox[name]
	local shown = text and string.format("%d chars: %s", #text, text:sub(1, 40)) or "body did not run"
	Say(string.format("slot %02d %s%s in %.2f ms | %s", n, loaded and "loaded" or "not loaded",
		reason and (" (" .. tostring(reason) .. ")") or "", ms, shown))
	Record("slots", { slot = n, loaded = loaded and true or false, reason = reason and tostring(reason),
		ms = ms, chars = text and #text, head = text and text:sub(1, 80) })
end

local probeFrame
local function ProbeFont(path)
	local fs = probeFrame:CreateFontString(nil, "OVERLAY")
	local ok, ret = pcall(fs.SetFont, fs, path, 14, "")
	pcall(fs.SetText, fs, "Seer probe")
	local got = fs:GetFont()
	return string.format("ret=%s font=%s w=%.0f", ok and tostring(ret) or ("error " .. tostring(ret)),
		got and "set" or "nil", fs:GetStringWidth() or -1)
end

local function ProbeTexture(path)
	local t = probeFrame:CreateTexture(nil, "OVERLAY")
	local ok, ret = pcall(t.SetTexture, t, path)
	return string.format("ret=%s id=%s path=%s", ok and tostring(ret) or ("error " .. tostring(ret)),
		tostring(t.GetTextureFileID and t:GetTextureFileID()), tostring(t.GetTextureFilePath and t:GetTextureFilePath()))
end

local function ProbeSound(path)
	local ok, willPlay, handle = pcall(PlaySoundFile, path, "Master")
	if ok and willPlay and handle then StopSound(handle) end
	return ok and ("play=" .. tostring(willPlay)) or ("error " .. tostring(willPlay))
end

local function ParseIndices(arg)
	local list = {}
	for part in (arg or ""):gmatch("[^,%s]+") do
		local a, b = part:match("^(%d+)%-(%d+)$")
		if a then
			for i = tonumber(a), tonumber(b) do list[#list + 1] = i end
		elseif tonumber(part) then
			list[#list + 1] = tonumber(part)
		end
	end
	return list
end

-- "fresh" adds one more "\." segment per call so the path never repeats and cannot hit a path-keyed cache.
local function Probe(arg)
	local indices = ParseIndices(arg)
	if #indices == 0 then Say("Usage: /seerspike probe 1-4") return end
	if not probeFrame then
		probeFrame = CreateFrame("Frame", nil, UIParent)
		probeFrame:SetSize(1, 1)
		probeFrame:SetPoint("TOPLEFT")
		probeFrame:SetAlpha(0)
	end
	probeCalls = probeCalls + 1
	local fresh = BASE .. "probe" .. string.rep("\\.", probeCalls) .. "\\"
	local plain = BASE .. "probe\\"
	for _, i in ipairs(indices) do
		local entry = { index = i, call = probeCalls }
		for _, kind in ipairs({ "font", "tex", "snd" }) do
			local ext = kind == "font" and ".ttf" or kind == "tex" and ".tga" or ".wav"
			local fn = kind == "font" and ProbeFont or kind == "tex" and ProbeTexture or ProbeSound
			local file = string.format("%s%02d%s", kind, i, ext)
			entry[kind .. "Plain"] = fn(plain .. file)
			entry[kind .. "Fresh"] = fn(fresh .. file)
			Say(string.format("probe %d %s | plain %s | fresh %s", i, kind, entry[kind .. "Plain"], entry[kind .. "Fresh"]))
		end
		Record("probes", entry)
	end
end

if ActionStatus then
	ActionStatus:HookScript("OnShow", function(self)
		if GetTime() < hideStatusUntil then self:Hide() end
	end)
end

local events = CreateFrame("Frame")
events:RegisterEvent("ADDON_LOADED")
events:RegisterEvent("PLAYER_LOGIN")
events:RegisterEvent("SCREENSHOT_SUCCEEDED")
events:RegisterEvent("SCREENSHOT_FAILED")
events:RegisterEvent("ADDON_ACTION_BLOCKED")
events:RegisterEvent("ADDON_ACTION_FORBIDDEN")
events:SetScript("OnEvent", function(_, event, arg1, arg2)
	if event == "ADDON_LOADED" then
		if arg1 ~= "SeerSpike" then return end
		SeerSpikeResults = SeerSpikeResults or {}
		db = SeerSpikeResults
		db.shots = db.shots or {}
		db.slots = db.slots or {}
		db.probes = db.probes or {}
		db.nextSeq = db.nextSeq or 1
	elseif event == "PLAYER_LOGIN" then
		db.env = Env()
	elseif event == "ADDON_ACTION_BLOCKED" or event == "ADDON_ACTION_FORBIDDEN" then
		if arg1 == "SeerSpike" then
			Say(event .. ": " .. tostring(arg2))
			if shot then shot.blocked = event .. ":" .. tostring(arg2) end
		end
	elseif shot and shot.takenAt then
		hideStatusUntil = GetTime() + 3
		if ActionStatus and ActionStatus:IsShown() then ActionStatus:Hide() end
		shot.eventMs = (Now() - shot.takenAt) * 1000
		shot.framesToEvent = shot.frames
		Finish(event == "SCREENSHOT_SUCCEEDED" and "ok" or "failed")
	end
end)

local function Status()
	local e = Env()
	Say(string.format("build %s (%s), physical %dx%d, UI %.0fx%.0f scale %.3f, screenshotFormat %s",
		tostring(e.build[1]), tostring(e.build[2]), e.physical[1], e.physical[2], e.ui[1], e.ui[2], e.ui[3],
		tostring(e.cvars.screenshotFormat)))
	Say(string.format("%d shots, %d slot loads, %d probes recorded; next slot %d, next seq %d",
		#db.shots, #db.slots, #db.probes, nextSlot, db.nextSeq))
end

SLASH_SEERSPIKE1 = "/seerspike"
SLASH_SEERSPIKE2 = "/sspike"
SlashCmdList.SEERSPIKE = function(msg)
	local ok, err = pcall(function()
		local args = {}
		for word in strtrim(msg or ""):lower():gmatch("%S+") do args[#args + 1] = word end
		local cmd = table.remove(args, 1)
		if cmd == "shot" then
			Shot(args)
		elseif cmd == "sweep" then
			Sweep()
		elseif cmd == "slot" then
			Slot(args[1])
		elseif cmd == "probe" then
			Probe(table.concat(args, ","))
		elseif cmd == "png" then
			SetCVarValue("screenshotFormat", "png")
			Say("screenshotFormat is now " .. tostring(CVar("screenshotFormat")))
		elseif cmd == "show" then
			if shot then return end
			BuildStrip({ bits = 1, cell = 4, hide = HIDE_ON_EVENT, seq = 0 })
			strip:SetShown(not strip:IsShown())
		elseif cmd == "clear" then
			wipe(db.shots); wipe(db.slots); wipe(db.probes)
			Say("Results cleared.")
		elseif cmd == "status" then
			Status()
		else
			Say("/seerspike png | shot [bits cell hide pre] | sweep | slot [n] | probe 1-4 | status | show | clear")
		end
	end)
	if not ok then Say("|cffff4040error|r " .. tostring(err)) end
end
