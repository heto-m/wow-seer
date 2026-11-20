local _, ns = ...

local floor = math.floor
local BITS = 2
local COLS_MAX, ROWS_MAX = 1024, 16
local HEADER_X, HEADER_CELLS = 68, 54
local TAIL_X = HEADER_X + 4 * HEADER_CELLS
local BUILD_PER_FRAME = 4096
-- Screenshots are named by the second; two in the same second overwrite each other.
local PART_GAP = 1.05
local TIMEOUT = 10

-- 16 rows (16384 textures) gave screenshots with no UI at all; 8 work.
local Strip = { cell = 1, rows = 8, pre = 1 }
ns.Strip = Strip

local frame, pools = nil, { column = {}, sync = {}, header = {}, tail = {}, payload = {} }
local job
local hideStatusUntil = 0

local function Adler(s)
	local a, b = 1, 0
	for i = 1, #s do
		a = (a + s:byte(i)) % 65521
		b = (b + a) % 65521
	end
	return a, b
end

local function Cell(pool, i)
	local t = pool[i]
	if not t then
		t = frame:CreateTexture(nil, "OVERLAY")
		pool[i] = t
	end
	return t
end

local placedX, placedY, placedSize, shown = {}, {}, {}, {}

local function Place(t, x, y, size, r, g, b)
	if placedX[t] ~= x or placedY[t] ~= y or placedSize[t] ~= size then
		t:ClearAllPoints()
		t:SetPoint("TOPLEFT", frame, "TOPLEFT", x, -y)
		t:SetSize(size, size)
		placedX[t], placedY[t], placedSize[t] = x, y, size
	end
	t:SetColorTexture(r, g, b, 1)
	if not shown[t] then
		t:Show()
		shown[t] = true
	end
end

local function HideFrom(pool, from)
	for i = from, #pool do
		local t = pool[i]
		if shown[t] then
			t:Hide()
			shown[t] = false
		end
	end
end

local function EnsureFrame()
	if frame then return end
	-- No parent: UIParent fades in after login and hides with Alt+Z.
	frame = CreateFrame("Frame", nil, nil)
	frame:SetFrameStrata("TOOLTIP")
	frame:SetFrameLevel(10000)
	frame:SetIgnoreParentScale(true)
	frame:SetPoint("TOPLEFT", WorldFrame, "TOPLEFT", 0, 0)
	local bg = frame:CreateTexture(nil, "BACKGROUND")
	bg:SetAllPoints()
	bg:SetColorTexture(0, 0, 0, 1)
	frame:Hide()
end

function Strip.Columns()
	local physW = GetPhysicalScreenSize()
	return math.min(COLS_MAX, floor((physW - 16) / Strip.cell))
end

function Strip.Capacity()
	return Strip.Columns() * Strip.rows * 3 * BITS / 8
end

local function HeaderBytes(p)
	local a, b = Adler(p.data)
	local h = { 83, 82, 1, BITS, p.cell, floor(p.msg / 256) % 256, p.msg % 256, p.part, p.parts,
		floor(#p.data / 256), #p.data % 256, floor(p.cols / 256), p.cols % 256, p.rows,
		floor(b / 256), b % 256, floor(a / 256), a % 256, 0 }
	local sum = 0
	for i = 1, #h do sum = sum + h[i] end
	h[#h + 1] = sum % 256
	return h
end

local function LayoutFixed(p)
	local _, physH = GetPhysicalScreenSize()
	frame:SetScale(768 / physH)
	local height = 8 + p.rows * p.cell
	local width = math.max(4 + p.cols * p.cell, TAIL_X + 32)
	frame:SetSize(width, height)

	local nv = math.ceil(height / 4)
	for i = 1, nv do
		local v = (i % 2 == 1) and 1 or 0
		Place(Cell(pools.column, i), 0, (i - 1) * 4, 4, v, v, v)
	end
	HideFrom(pools.column, nv + 1)
	for j = 1, 16 do
		local v = (j % 2 == 0) and 1 or 0
		Place(Cell(pools.sync, j), 4 * j, 0, 4, v, v, v)
	end
	local bits = {}
	for _, byte in ipairs(HeaderBytes(p)) do
		for i = 7, 0, -1 do bits[#bits + 1] = floor(byte / 2 ^ i) % 2 end
	end
	for k = 1, HEADER_CELLS do
		Place(Cell(pools.header, k), HEADER_X + 4 * (k - 1), 0, 4,
			bits[3 * k - 2] or 0, bits[3 * k - 1] or 0, bits[3 * k] or 0)
	end
	local tail = floor((width - TAIL_X) / 4)
	for m = 1, tail do
		local v = (m % 2 == 1) and 1 or 0
		Place(Cell(pools.tail, m), TAIL_X + 4 * (m - 1), 0, 4, v, v, v)
	end
	HideFrom(pools.tail, tail + 1)
end

local function BuildPayload(p, fromGroup, toGroup)
	local data, cols, cell = p.data, p.cols, p.cell
	for g = fromGroup, toGroup do
		local i = 3 * g - 2
		local v = (data:byte(i) or 0) * 65536 + (data:byte(i + 1) or 0) * 256 + (data:byte(i + 2) or 0)
		for c = 0, 3 do
			local shift = 4 ^ (9 - 3 * c)
			local r = floor(v / (shift * 16)) % 4
			local gr = floor(v / (shift * 4)) % 4
			local bl = floor(v / shift) % 4
			local n = 4 * (g - 1) + c
			Place(Cell(pools.payload, n + 1), 4 + (n % cols) * cell, 8 + floor(n / cols) * cell, cell, r / 3, gr / 3, bl / 3)
		end
	end
end

local driver = CreateFrame("Frame")
driver:Hide()
local Clock = debugprofilestop or function() return GetTime() * 1000 end

-- Runs past Finish: the encode stall can land in any frame up to a few after SCREENSHOT_SUCCEEDED.
local watch = CreateFrame("Frame")
local watchStats, watchFrames, watchEventAt
watch:Hide()
watch:SetScript("OnUpdate", function(self, elapsed)
	watchStats.hitch = math.max(watchStats.hitch or 0, elapsed * 1000)
	watchFrames = watchFrames + 1
	if (watchEventAt and watchFrames >= watchEventAt + 3) or watchFrames >= 600 then self:Hide() end
end)

local function Debug(text)
	if ns.debug then print(string.format("|cff9b7bffSeer|r %.2f %s", GetTime(), text)) end
end

local function Finish(ok, why)
	Debug("done " .. tostring(ok) .. " " .. tostring(why))
	local j = job
	job = nil
	driver:Hide()
	if frame then frame:Hide() end
	if j and j.done then j.done(ok, why) end
end

local function StartPart()
	local p = job.parts[job.index]
	EnsureFrame()
	frame:Hide()
	local cells = math.ceil(#p.data / 3) * 4
	p.rows = math.ceil(cells / p.cols)
	LayoutFixed(p)
	p.groups = math.ceil(#p.data / 3)
	p.built = 0
	HideFrom(pools.payload, p.groups * 4 + 1)
	job.phase = "build"
	job.started = GetTime()
	driver:Show()
end

driver:SetScript("OnUpdate", function(_, elapsed)
	local ok, err = pcall(function()
		if not job then driver:Hide() return end
		job.lastElapsed = elapsed
		if GetTime() - job.started > TIMEOUT then Finish(false, "timeout") return end
		if job.phase ~= "taken" and InCombatLockdown() then Finish(false, "combat") return end
		local p = job.parts[job.index]
		if job.phase == "build" then
			local to = math.min(p.groups, p.built + BUILD_PER_FRAME / 4)
			local at = Clock()
			BuildPayload(p, p.built + 1, to)
			job.stats.build = math.max(job.stats.build, Clock() - at)
			p.built = to
			if to >= p.groups then
				frame:Show()
				job.phase = "show"
				job.waited = 0
				if ns.debug then Debug(string.format("part %d/%d shown: %d bytes, %d rows, visible %s, alpha %.2f",
					job.index, #job.parts, #p.data, p.rows, tostring(frame:IsVisible()), frame:GetEffectiveAlpha())) end
			end
		elseif job.phase == "show" and job.waited < Strip.pre - 1 then
			job.waited = job.waited + 1
		elseif job.phase == "show" then
			hideStatusUntil = GetTime() + 3
			local st = job.stats
			st.usual = math.max(st.usual or 0, (job.lastElapsed or 0) * 1000)
			st.shots = st.shots + 1
			Screenshot()
			watchStats, watchFrames, watchEventAt = st, 0, nil
			watch:Show()
			Debug("screenshot called")
			job.phase = "taken"
			job.hideNext = true
		elseif job.hideNext then
			frame:Hide()
			job.hideNext = false
		end
	end)
	if not ok then Finish(false, tostring(err)) end
end)

function Strip.OnScreenshot(succeeded)
	if not job or job.phase ~= "taken" then return end
	if ActionStatus and ActionStatus:IsShown() then ActionStatus:Hide() end
	hideStatusUntil = GetTime() + 3
	Debug("screenshot event " .. tostring(succeeded))
	watchEventAt = watchFrames
	if not succeeded then Finish(false, "screenshot failed") return end
	if job.index >= #job.parts then Finish(true) return end
	job.index = job.index + 1
	job.phase = "wait"
	C_Timer.After(PART_GAP, function()
		if job then StartPart() end
	end)
end

function Strip.Busy()
	return job ~= nil
end

function Strip.Send(msg, text, done)
	if job then return false end
	local cols = Strip.Columns()
	local per = floor(cols * math.min(Strip.rows, ROWS_MAX) * 3 * BITS / 8 / 3) * 3
	local parts, n = {}, math.max(1, math.ceil(#text / per))
	if n > 255 then return false end
	for k = 1, n do
		parts[k] = { msg = msg % 65536, part = k, parts = n, cols = cols, cell = Strip.cell,
			data = text:sub((k - 1) * per + 1, k * per) }
	end
	job = { parts = parts, index = 1, done = done, stats = { build = 0, shots = 0 } }
	Strip.lastStats = job.stats
	StartPart()
	return true
end

if ActionStatus then
	ActionStatus:HookScript("OnShow", function(self)
		if GetTime() < hideStatusUntil then self:Hide() end
	end)
end
