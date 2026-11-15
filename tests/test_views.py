import unittest

from wow_seer import server, views

SET = [" ", "Vestiduras (2/5)", "  Atuendo", "  Fajín", " ", "Conjunto: +10 p. de intelecto.", " "]
CHEST = {"slot": "chest", "id": 1, "name": "Atuendo", "quality": 3, "durability": [30, 75],
         "tooltip": ["Atuendo", "Ligado", "Pecho\tTela", "41 armadura", "+10 intelecto"] + SET
         + ["Durabilidad 30 / 75", "Necesitas ser de nivel 18"]}
WAIST = {"slot": "waist", "id": 2, "name": "Fajín", "quality": 3,
         "tooltip": ["Fajín", "Ligado", "Cintura\tTela", "+6 intelecto"] + SET + ["Durabilidad 20 / 20"]}
RING = {"slot": "finger1", "id": 3, "name": "Sortija", "quality": 2,
        "tooltip": ["Sortija", "Ligado", "Dedo", "+4 fuerza", "+2 aguante", "Encantado: +2 de aguante"]}


class Views(unittest.TestCase):
    def test_tidy_tooltip(self):
        lines, set_info, durability = views.tidy_tooltip(CHEST["tooltip"], "Atuendo")
        self.assertEqual(lines, ["Pecho\tTela", "41 armadura", "+10 intelecto", "Necesitas ser de nivel 18"])
        self.assertEqual(set_info, {"name": "Vestiduras", "have": "2/5", "pieces": ["Atuendo", "Fajín"],
                                    "bonuses": ["Conjunto: +10 p. de intelecto."]})
        self.assertEqual(durability, "30/75")
        self.assertEqual(views.tidy_tooltip(["Usar: 10 |4min:mins; cd"])[0], ["Usar: 10 mins cd"])

    def test_equipment_lists_a_set_once(self):
        out = views.equipment([CHEST, WAIST])
        self.assertEqual([i["set"] for i in out["items"]], ["Vestiduras", "Vestiduras"])
        self.assertEqual(list(out["sets"]), ["Vestiduras"])
        summary = views.equipment([CHEST, WAIST], slots=["waist"], detail="summary")
        self.assertEqual(summary, {"cols": ["slot", "id", "name", "quality"], "rows": [["waist", 2, "Fajín", 3]]})

    def test_table_keeps_zero(self):
        self.assertEqual(views.table([{"a": 0, "b": None, "c": False}], ["a", "b", "c"]),
                         {"cols": ["a"], "rows": [[0]]})

    def test_talents_taken(self):
        t = {"unspent": 1, "talents": [{"name": "B", "rank": 0, "max": 5, "x": 1, "y": 2},
                                       {"name": "A", "rank": 2, "max": 2, "x": 1, "y": 1}]}
        self.assertEqual(views.talents(t), {"unspent": 1, "spent": 2, "taken": ["A 2/2"]})
        self.assertEqual(views.talents(t, True)["talents"], ["A 2/2", "B 0/5"])

    def test_bags_merge_and_find(self):
        sections = {"bags": [{"bag": 0, "size": 16, "items": [
            {"slot": 1, "id": 9, "name": "Poción de maná", "count": 5},
            {"slot": 2, "id": 9, "name": "Poción de maná", "count": 3},
            {"slot": 3, "id": 7, "name": "Anillo", "count": 1, "loc": "INVTYPE_FINGER",
             "tooltip": ["Anillo", "Dedo", "+3 intelecto"]}]}]}
        out = views.bags(sections, name="POCION")
        self.assertEqual(out["items"]["rows"], [[9, "Poción de maná", 8]])
        self.assertEqual(out["space"], {"bags": "13/16 free"})
        self.assertEqual(views.bags(sections, equippable_only=True, detail="full")["tooltips"],
                         {"7": ["Dedo", "+3 intelecto"]})
        self.assertEqual(views.find_item(sections, "7")["rows"], [["bags", 0, 3, 7, "Anillo", 1]])

    def test_compare(self):
        ring = {"id": 7, "name": "Anillo", "loc": "INVTYPE_FINGER", "tooltip": ["Anillo", "Dedo", "+3 intelecto"]}
        out = views.compare(ring, [CHEST, RING])
        self.assertEqual([e["slot"] for e in out["equipped"]], ["finger1"])
        self.assertEqual(out["equipped"][0]["diff"], {"aguante": -2, "fuerza": -4, "intelecto": 3})
        out = views.compare(dict(ring, loc=None), [RING])
        self.assertEqual(out["equipped"][0]["slot"], "finger1")

    def test_auction_filters_and_groups(self):
        a = {"browse": [
            {"id": 1, "name": "Varita funesta", "type": "Varitas", "level": 21, "minPrice": 2248, "quality": 2,
             "loc": "INVTYPE_RANGEDRIGHT"},
            {"id": 2, "name": "Varita alta", "type": "Varitas", "level": 30, "minPrice": 5000, "quality": 2},
            {"id": 3, "name": "Espada", "type": "Espadas", "level": 20, "minPrice": 100, "quality": 2}],
            "search": {"id": 1, "name": "Varita funesta", "rows": [
                {"buyout": 2248, "quantity": 1, "name": "Varita funesta"},
                {"buyout": 2248, "quantity": 1, "name": "Varita funesta"},
                {"buyout": 3000, "quantity": 1, "name": "Varita funesta"}]}}
        out = views.auction(a, type="varita", max_level=24)
        self.assertEqual([r[0] for r in out["browse"]["rows"]], [1])
        self.assertEqual(views.auction(a, slot="ranged")["browse"]["rows"][0][0], 1)
        self.assertEqual(out["search"]["prices"], {"cols": ["buyout", "quantity", "auctions"],
                                                   "rows": [[2248, 2, 2], [3000, 1, 1]]})

    def test_every_tool_handles_missing_data(self):
        state = server.State()
        for tool in server.TOOLS:
            args = {"query": "x"} if tool["name"] == "find_item" else {}
            self.assertIsInstance(server.call_tool(state, tool["name"], args), dict, tool["name"])


if __name__ == "__main__":
    unittest.main()
