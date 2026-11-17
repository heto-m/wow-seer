local _, ns = ...

local collect = {}
ns.collect = collect

local MAX_ROWS = 60
local SLOT_NAMES = {
	"head", "neck", "shoulder", "shirt", "chest", "waist", "legs", "feet", "wrist", "hands",
	"finger1", "finger2", "trinket1", "trinket2", "back", "mainhand", "offhand", "ranged", "tabard",
}

local function Try(fn, ...)
	if not fn then return nil end
	local ok, a, b, c, d, e, f, g, h, i, j = pcall(fn, ...)
	if ok then return a, b, c, d, e, f, g, h, i, j end
end

local function Clean(text)
	if type(text) ~= "string" or (issecretvalue and issecretvalue(text)) then return nil end
	text = text:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("|T.-|t", ""):gsub("|A.-|a", "")
	return text ~= "" and text or nil
end

local function LinkName(link)
	return type(link) == "string" and link:match("|h%[(.-)%]|h") or nil
end

local function TooltipLines(data)
	if type(data) ~= "table" or type(data.lines) ~= "table" then return nil end
	local lines = {}
	for _, line in ipairs(data.lines) do
		local left, right = Clean(line.leftText), Clean(line.rightText)
		if left and right then
			lines[#lines + 1] = left .. "\t" .. right
		elseif left or right then
			lines[#lines + 1] = left or right
		end
	end
	return lines
end

ns.TooltipLines = TooltipLines

local function ItemName(id, link)
	return LinkName(link) or Try(C_Item and C_Item.GetItemNameByID, id)
end

local function Equippable(id)
	return Try(C_Item and C_Item.IsEquippableItem, id) and true or false
end

local function EquipLoc(id)
	local _, _, _, loc = Try((C_Item and C_Item.GetItemInfoInstant) or GetItemInfoInstant, id)
	if type(loc) == "string" and loc:find("^INVTYPE_") and not loc:find("^INVTYPE_NON_EQUIP") then return loc end
end

function collect.player()
	local p = {
		name = UnitName("player"),
		realm = GetRealmName(),
		level = UnitLevel("player"),
		class = select(2, UnitClass("player")),
		classLocal = UnitClass("player"),
		race = select(2, UnitRace("player")),
		raceLocal = UnitRace("player"),
		sex = UnitSex("player"),
		money = GetMoney(),
		xp = Try(UnitXP, "player"),
		xpMax = Try(UnitXPMax, "player"),
		restedXp = Try(GetXPExhaustion),
		zone = Try(GetRealZoneText),
		subzone = Try(GetSubZoneText),
		healthMax = Try(UnitHealthMax, "player"),
		powerMax = Try(UnitPowerMax, "player"),
		powerType = select(2, Try(UnitPowerType, "player")),
		armor = select(2, Try(UnitArmor, "player")),
		locale = GetLocale(),
		stats = {},
	}
	for i, key in ipairs({ "strength", "agility", "stamina", "intellect", "spirit" }) do
		local _, value = Try(UnitStat, "player", i)
		p.stats[key] = value
	end
	p.stats.spellDamage = Try(GetSpellBonusDamage, 2)
	p.stats.healing = Try(GetSpellBonusHealing)
	p.stats.attackPower = Try(UnitAttackPower, "player")
	p.stats.crit = Try(GetCritChance)
	p.stats.spellCrit = Try(GetSpellCritChance, 2)
	p.stats.dodge = Try(GetDodgeChance)
	return p
end

function collect.equipment()
	local items = {}
	for slot, key in ipairs(SLOT_NAMES) do
		local id = GetInventoryItemID("player", slot)
		if id then
			local link = GetInventoryItemLink("player", slot)
			items[#items + 1] = {
				slot = key,
				id = id,
				name = ItemName(id, link),
				quality = GetInventoryItemQuality("player", slot),
				durability = { Try(GetInventoryItemDurability, slot) },
				tooltip = TooltipLines(Try(C_TooltipInfo and C_TooltipInfo.GetInventoryItem, "player", slot)),
			}
		end
	end
	return items
end

local function Container(bags)
	local out = {}
	for _, bag in ipairs(bags) do
		local slots = Try(C_Container.GetContainerNumSlots, bag) or 0
		local entry = { bag = bag, size = slots, items = {} }
		if bag > 0 and C_Container.ContainerIDToInventoryID then
			local inv = Try(C_Container.ContainerIDToInventoryID, bag)
			local link = inv and GetInventoryItemLink("player", inv)
			entry.name = LinkName(link)
		end
		for slot = 1, slots do
			local info = Try(C_Container.GetContainerItemInfo, bag, slot)
			if info and info.itemID then
				local item = {
					slot = slot,
					id = info.itemID,
					name = ItemName(info.itemID, info.hyperlink),
					count = info.stackCount,
					quality = info.quality,
					bound = info.isBound,
				}
				if Equippable(info.itemID) then
					item.tooltip = TooltipLines(Try(C_TooltipInfo and C_TooltipInfo.GetBagItem, bag, slot))
					item.loc = EquipLoc(info.itemID)
				end
				entry.items[#entry.items + 1] = item
			end
		end
		out[#out + 1] = entry
	end
	return out
end

function collect.bags()
	return Container({ 0, 1, 2, 3, 4 })
end

function collect.bank()
	if not ns.bankOpen then return nil end
	return Container({ -1, 5, 6, 7, 8, 9, 10 })
end

function collect.quests()
	local out, header = {}, nil
	local n = Try(C_QuestLog.GetNumQuestLogEntries) or 0
	for i = 1, n do
		local q = Try(C_QuestLog.GetInfo, i)
		if q and q.isHeader then
			header = q.title
		elseif q and not q.isHidden then
			local entry = {
				id = q.questID,
				title = q.title,
				level = q.level,
				zone = header,
				complete = Try(C_QuestLog.IsComplete, q.questID) and true or false,
				failed = Try(C_QuestLog.IsFailed, q.questID) and true or nil,
				objectives = {},
			}
			for _, o in ipairs(Try(C_QuestLog.GetQuestObjectives, q.questID) or {}) do
				entry.objectives[#entry.objectives + 1] = {
					text = Clean(o.text), done = o.finished, have = o.numFulfilled, need = o.numRequired,
				}
			end
			out[#out + 1] = entry
		end
	end
	return out
end

local function TraitName(config, entryID)
	local e = entryID and Try(C_Traits.GetEntryInfo, config, entryID)
	local d = e and e.definitionID and Try(C_Traits.GetDefinitionInfo, e.definitionID)
	if not d then return nil end
	if d.overrideName and d.overrideName ~= "" then return d.overrideName end
	return d.spellID and Try(C_Spell and C_Spell.GetSpellName, d.spellID)
end

local function TraitTalents()
	local config = Try(C_ClassTalents and C_ClassTalents.GetActiveConfigID)
	local info = config and Try(C_Traits.GetConfigInfo, config)
	if not info or type(info.treeIDs) ~= "table" then return nil end
	local out = { talents = {} }
	for _, tree in ipairs(info.treeIDs) do
		for _, c in ipairs(Try(C_Traits.GetTreeCurrencyInfo, config, tree, false) or {}) do
			if type(c.quantity) == "number" then out.unspent = (out.unspent or 0) + c.quantity end
		end
		for _, id in ipairs(Try(C_Traits.GetTreeNodes, tree) or {}) do
			local node = Try(C_Traits.GetNodeInfo, config, id)
			if node and node.ID and node.ID ~= 0 and (node.maxRanks or 0) > 0 then
				local entry = (node.activeEntry and node.activeEntry.entryID) or (node.entryIDs and node.entryIDs[1])
				out.talents[#out.talents + 1] = {
					name = TraitName(config, entry), rank = node.activeRank or 0, max = node.maxRanks,
					x = node.posX, y = node.posY,
				}
			end
		end
	end
	local spec = Try(C_SpecializationInfo and C_SpecializationInfo.GetSpecialization)
	if spec then out.spec = select(2, Try(C_SpecializationInfo.GetSpecializationInfo, spec)) end
	return out
end

function collect.talents()
	if C_Traits then
		local t = TraitTalents()
		if t then return t end
	end
	local out = { unspent = Try(UnitCharacterPoints, "player"), tabs = {} }
	for tab = 1, Try(GetNumTalentTabs) or 0 do
		local t = { info = { Try(GetTalentTabInfo, tab) }, talents = {} }
		for i = 1, Try(GetNumTalents, tab) or 0 do
			local name, _, tier, column, rank, maxRank = Try(GetTalentInfo, tab, i)
			if name then
				t.talents[#t.talents + 1] = { name = name, tier = tier, column = column, rank = rank, max = maxRank }
			end
		end
		out.tabs[#out.tabs + 1] = t
	end
	return out
end

function collect.skills()
	local out = {}
	local indices = { Try(GetProfessions) }
	for i = 1, 6 do
		if indices[i] then
			local name, _, rank, maxRank, _, _, _, modifier = Try(GetProfessionInfo, indices[i])
			if name then out[#out + 1] = { name = name, rank = rank, bonus = modifier, max = maxRank } end
		end
	end
	if #out > 0 then return out end
	local header
	for i = 1, Try(GetNumSkillLines) or 0 do
		local name, isHeader, _, rank, _, modifier, maxRank = Try(GetSkillLineInfo, i)
		if isHeader then
			header = name
		elseif name then
			out[#out + 1] = { name = name, group = header, rank = rank, bonus = modifier, max = maxRank }
		end
	end
	return out
end

function collect.trainer()
	if not ns.trainerOpen then return nil end
	local out = { npc = UnitName("npc"), services = {} }
	for i = 1, Try(GetNumTrainerServices) or 0 do
		local name, sub, kind = Try(GetTrainerServiceInfo, i)
		if name and kind ~= "header" then
			local skill, skillRank = Try(GetTrainerServiceSkillReq, i)
			out.services[#out.services + 1] = {
				name = name, rank = sub, status = kind, cost = Try(GetTrainerServiceCost, i),
				level = Try(GetTrainerServiceLevelReq, i), skill = skill, skillRank = skillRank,
			}
		end
	end
	return out
end

function collect.profession()
	if not ns.professionOpen or not C_TradeSkillUI then return nil end
	local base = Try(C_TradeSkillUI.GetBaseProfessionInfo) or {}
	local out = { name = base.professionName, level = base.skillLevel, max = base.maxSkillLevel, recipes = {} }
	for _, id in ipairs(Try(C_TradeSkillUI.GetAllRecipeIDs) or {}) do
		local r = Try(C_TradeSkillUI.GetRecipeInfo, id)
		if r and r.learned then
			local recipe = { id = id, name = r.name, difficulty = r.relativeDifficulty, canMake = r.numAvailable, reagents = {} }
			local schematic = Try(C_TradeSkillUI.GetRecipeSchematic, id, false)
			for _, slot in ipairs(schematic and schematic.reagentSlotSchematics or {}) do
				local reagent = slot.reagents and slot.reagents[1]
				if reagent and reagent.itemID then
					recipe.reagents[#recipe.reagents + 1] = {
						id = reagent.itemID, name = ItemName(reagent.itemID), count = slot.quantityRequired,
					}
				end
			end
			out.recipes[#out.recipes + 1] = recipe
		end
	end
	return out
end

function collect.merchant()
	if not ns.merchantOpen then return nil end
	local out = { npc = UnitName("npc"), items = {} }
	for i = 1, Try(GetMerchantNumItems) or 0 do
		local name, _, price, quantity, available, usable = Try(GetMerchantItemInfo, i)
		if name then
			out.items[#out.items + 1] = {
				id = Try(GetMerchantItemID, i), name = name, price = price, stack = quantity,
				available = available, usable = usable,
			}
		end
	end
	return out
end

local function ItemFacts(id)
	local name, _, quality, _, minLevel, _, subType = Try(C_Item.GetItemInfo, id)
	if not name then
		Try(C_Item.RequestLoadItemDataByID, id)
		ns.auctionMissingNames = true
	end
	return name, quality, minLevel, subType
end

local function KeyName(key)
	local info = Try(C_AuctionHouse.GetItemKeyInfo, key)
	return info and info.itemName or ItemFacts(key.itemID)
end

local MAX_BROWSE = 500
local BROWSE_COLS = { "id", "itemLevel", "name", "quality", "level", "type", "minPrice", "quantity", "loc" }

-- Rows go out as arrays to halve the payload; false stands in for nil because nil breaks Lua array length.
local function Cell(v)
	if v == nil then return false end
	return v
end

function ns.AuctionBrowse()
	ns.auctionMissingNames = false
	local rows = {}
	for i, r in ipairs(Try(C_AuctionHouse.GetBrowseResults) or {}) do
		if i > MAX_BROWSE then break end
		local key = r.itemKey
		local name, quality, minLevel, subType = ItemFacts(key.itemID)
		rows[#rows + 1] = {
			key.itemID, Cell(key.itemLevel), Cell(KeyName(key) or name), Cell(quality), Cell(minLevel), Cell(subType),
			Cell(r.minPrice), Cell(r.totalQuantity), Cell(EquipLoc(key.itemID)),
		}
	end
	return { cols = BROWSE_COLS, rows = rows }
end

function ns.AuctionCommodity(itemID)
	local rows = {}
	for i = 1, math.min(Try(C_AuctionHouse.GetNumCommoditySearchResults, itemID) or 0, MAX_ROWS) do
		local r = Try(C_AuctionHouse.GetCommoditySearchResultInfo, itemID, i)
		if r then rows[#rows + 1] = { unitPrice = r.unitPrice, quantity = r.quantity } end
	end
	return { id = itemID, name = ItemName(itemID), rows = rows }
end

-- A random suffix's stats live only in each auction's link; one browse row can mix stat tiers.
function ns.AuctionItem(key)
	local rows, tooltips = {}, {}
	local suffixed = key.itemSuffix and key.itemSuffix ~= 0
	for i = 1, math.min(Try(C_AuctionHouse.GetNumItemSearchResults, key) or 0, MAX_ROWS) do
		local r = Try(C_AuctionHouse.GetItemSearchResultInfo, key, i)
		if r then
			local item = suffixed and type(r.itemLink) == "string" and r.itemLink:match("item:[%-%d:]+") or nil
			if item and not tooltips[item] then
				tooltips[item] = TooltipLines(Try(C_TooltipInfo and C_TooltipInfo.GetHyperlink, r.itemLink)) or false
			end
			rows[#rows + 1] = {
				buyout = r.buyoutAmount, bid = r.bidAmount, quantity = r.quantity,
				name = LinkName(r.itemLink), timeLeft = r.timeLeft, item = item,
			}
		end
	end
	return { id = key.itemID, name = KeyName(key), rows = rows, tooltips = suffixed and tooltips or nil }
end

function collect.auction()
	if not ns.auction then return nil end
	return ns.auction
end

function collect.items()
	local out = {}
	for id in pairs(ns.wantedItems) do
		local lines = TooltipLines(Try(C_TooltipInfo and C_TooltipInfo.GetItemByID, id))
		out[#out + 1] = { id = id, name = ItemName(id), tooltip = lines, loc = EquipLoc(id) }
	end
	return out
end

local MAX_PRICED = 200
local CALLER = "Seer"

local function VendorPrice(id)
	local ok, price = pcall(function() return select(11, C_Item.GetItemInfo(id)) end)
	return ok and price or nil
end

local function AuctionatorPrice(api, id, link)
	if link then
		local price = Try(api.GetAuctionPriceByItemLink, CALLER, link)
		if price then return price, Try(api.GetAuctionAgeByItemLink, CALLER, link) end
	end
	return Try(api.GetAuctionPriceByItemID, CALLER, id), Try(api.GetAuctionAgeByItemID, CALLER, id)
end

function collect.prices()
	local want = ns.wantedPrices
	if not want then return nil end
	local api = Auctionator and Auctionator.API and Auctionator.API.v1
	local items, seen = {}, {}
	local function Add(id, link, count)
		local key = link and link:match("item:[%-%d:]+") or id
		if seen[key] then
			seen[key].count = (seen[key].count or 0) + (count or 0)
			return
		end
		if #items >= MAX_PRICED then return end
		local entry = { id = id, name = ItemName(id, link), count = count, vendor = VendorPrice(id) }
		if api then entry.price, entry.age = AuctionatorPrice(api, id, link) end
		seen[key] = entry
		items[#items + 1] = entry
	end
	for _, id in ipairs(want.items or {}) do
		if type(id) == "number" then Add(id) end
	end
	if want.bags then
		for bag = 0, 4 do
			for slot = 1, Try(C_Container.GetContainerNumSlots, bag) or 0 do
				local info = Try(C_Container.GetContainerItemInfo, bag, slot)
				if info and info.itemID then Add(info.itemID, info.hyperlink, info.stackCount) end
			end
		end
	end
	return { auctionator = api ~= nil, items = items }
end

ns.SECTIONS = {
	"player", "equipment", "bags", "bank", "quests", "talents", "skills",
	"trainer", "profession", "merchant", "auction", "items", "prices",
}
