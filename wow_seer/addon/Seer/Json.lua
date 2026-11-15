local _, ns = ...

local escapes = { ['"'] = '\\"', ["\\"] = "\\\\", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t" }

local function EscapeChar(c)
	return escapes[c] or string.format("\\u%04x", c:byte())
end

local function IsSecret(v)
	return issecretvalue ~= nil and issecretvalue(v)
end

local Encode

local function EncodeTable(t, out)
	if t[1] ~= nil or next(t) == nil then
		out[#out + 1] = "["
		for i = 1, #t do
			if i > 1 then out[#out + 1] = "," end
			Encode(t[i], out)
		end
		out[#out + 1] = "]"
		return
	end
	out[#out + 1] = "{"
	local first = true
	for k, v in pairs(t) do
		if not IsSecret(k) and not IsSecret(v) then
			if not first then out[#out + 1] = "," end
			first = false
			Encode(tostring(k), out)
			out[#out + 1] = ":"
			Encode(v, out)
		end
	end
	out[#out + 1] = "}"
end

Encode = function(v, out)
	local kind = type(v)
	if IsSecret(v) or v == nil then
		out[#out + 1] = "null"
	elseif kind == "string" then
		out[#out + 1] = '"' .. v:gsub('[%c"\\]', EscapeChar) .. '"'
	elseif kind == "number" then
		if v ~= v or v == math.huge or v == -math.huge then
			out[#out + 1] = "null"
		elseif v == math.floor(v) and math.abs(v) < 2 ^ 53 then
			out[#out + 1] = string.format("%d", v)
		else
			out[#out + 1] = string.format("%.6g", v)
		end
	elseif kind == "boolean" then
		out[#out + 1] = v and "true" or "false"
	elseif kind == "table" then
		EncodeTable(v, out)
	else
		out[#out + 1] = "null"
	end
end

function ns.ToJson(v)
	local out = {}
	Encode(v, out)
	return table.concat(out)
end
