import threading
import unittest
from unittest.mock import patch

from app import (
    SearchCache,
    _build_brake_index,
    _build_wiper_indexes,
    get_all_google_sheets_data,
    normalize_brake_pads_data,
    normalize_data,
    normalize_token_for_match,
    search_analogs,
    search_brake_pads_analogs,
    search_by_prefix,
)


WIPER_RAW_DATA = [
    {"main_part": "WIPER-100", "alt_parts": "W1ALT W2SECOND", "section": "Front Wipers"},
    {"main_part": "WIPER-200", "alt_parts": "W1ALT", "section": "Back Wipers"},
]
BRAKE_RAW_DATA = [
    {
        "main_part": "PAD-200",
        "oe_analogue": "P-ALT",
        "not_original": "P-SECOND",
        "section": "Front Brake Pads",
    }
]


def snapshot(wiper_raw=WIPER_RAW_DATA, brake_raw=BRAKE_RAW_DATA):
    wiper_normalized = normalize_data(wiper_raw)
    brake_normalized = normalize_brake_pads_data(brake_raw)
    wiper_exact, wiper_prefix = _build_wiper_indexes(wiper_normalized)
    return {
        "wiper_exact": wiper_exact,
        "wiper_prefix": wiper_prefix,
        "brake_exact": _build_brake_index(brake_normalized),
        "wiper_raw_count": len(wiper_raw),
        "wiper_normalized_count": len(wiper_normalized),
        "brake_raw_count": len(brake_raw),
        "brake_normalized_count": len(brake_normalized),
    }


class PartNumberNormalizationTests(unittest.TestCase):
    def test_spaced_alternative_is_one_article_and_legacy_lists_still_split(self):
        raw = [{
            "main_part": "MAIN-1",
            "alt_parts": "6R1 998 002, A-100 B.200 / C300",
            "section": "Front Wipers",
        }]
        normalized = normalize_data(raw)
        self.assertEqual(
            [item["alt_part"] for item in normalized],
            ["MAIN-1", "6R1 998 002", "A-100", "B.200", "C300"],
        )
        expected = [{
            "main_part": "MAIN-1",
            "all_parts": ["6R1 998 002", "MAIN-1"],
            "section": "Front Wipers",
        }]
        cache = SearchCache(loader=lambda: snapshot(wiper_raw=raw))
        self.assertTrue(cache.refresh_once())
        for query in ("6R1 998 002", "6R1-998-002", "6R1.998.002", "6r1998002"):
            with self.subTest(query=query):
                self.assertEqual(search_analogs(query, normalized), expected)
                self.assertEqual(cache.search_wipers(query), expected)

        # Two-item whitespace lists remain separate, even if one item has letters.
        for alternatives, parts in [
            ("1234 5678", ["1234", "5678"]),
            ("A100 5678", ["A100", "5678"]),
        ]:
            with self.subTest(alternatives=alternatives):
                legacy = normalize_data([{"main_part": "MAIN-2", "alt_parts": alternatives}])
                self.assertEqual([item["alt_part"] for item in legacy], ["MAIN-2", *parts])
                for part in parts:
                    self.assertEqual(search_analogs(part, legacy)[0]["all_parts"], sorted(["MAIN-2", part]))

    def test_only_case_and_approved_separators_are_ignored(self):
        for value in ("6R1 998 002", "6R1-998-002", "6R1.998.002", "6r1998002"):
            with self.subTest(value=value):
                self.assertEqual(normalize_token_for_match(value), "6R1998002")
        for value in ("6R1/998002", "6R1_998002", "6R1+998002", "6R1\t998002", "АБ123"):
            with self.subTest(value=value):
                self.assertEqual(normalize_token_for_match(value), value)
        self.assertEqual(normalize_token_for_match(None), "")
        self.assertEqual(normalize_token_for_match(123), "")
        self.assertEqual(normalize_token_for_match(" .- "), "")

    def test_wiper_variants_find_all_groups_and_keep_source_spelling(self):
        raw = [
            {"main_part": "6r1 998 002", "alt_parts": "A-100 B.200", "section": "Front Wipers"},
            {"main_part": "Other-300", "alt_parts": "6R1.998.002", "section": "Back Wipers"},
        ]
        normalized = normalize_data(raw)
        cache = SearchCache(loader=lambda: snapshot(wiper_raw=raw))
        self.assertTrue(cache.refresh_once())
        expected = [
            {
                "main_part": "6r1 998 002",
                "all_parts": ["6r1 998 002", "A-100", "B.200"],
                "section": "Front Wipers",
            },
            {
                "main_part": "Other-300",
                "all_parts": ["6R1.998.002", "Other-300"],
                "section": "Back Wipers",
            },
        ]
        for query in ("6R1 998 002", "6R1-998-002", "6R1.998.002", "6r1998002"):
            with self.subTest(query=query):
                self.assertEqual(cache.search_wipers(query), expected)
                self.assertEqual(search_analogs(query, normalized), expected)
        self.assertEqual(cache.search_wipers("a 1.00")[0]["all_parts"], ["6r1 998 002", "A-100"])
        self.assertEqual(cache.search_wipers("b-200")[0]["all_parts"], ["6r1 998 002", "B.200"])
        self.assertEqual(cache.search_wiper_prefix("6.r-1"), expected)
        self.assertEqual(search_by_prefix("6.r-1", normalized), expected)

    def test_brake_variants_find_all_groups_and_keep_source_fields(self):
        raw = [
            {
                "main_part": "6r1 998 002",
                "oe_analogue": "OE-100",
                "not_original": "Alt.200",
                "section": "Front Brake Pads",
            },
            {
                "main_part": "Other-300",
                "oe_analogue": "6R1.998.002",
                "not_original": "Alt 400",
                "section": "Rear Brake Pads",
            },
        ]
        normalized = normalize_brake_pads_data(raw)
        cache = SearchCache(loader=lambda: snapshot(brake_raw=raw))
        self.assertTrue(cache.refresh_once())
        for query in ("6R1 998 002", "6R1-998-002", "6R1.998.002", "6r1998002"):
            with self.subTest(query=query):
                self.assertEqual(cache.search_brake_pads(query), raw)
                self.assertEqual(search_brake_pads_analogs(query, normalized), raw)
        for query in ("oe 100", "alt-200", "ALT.400"):
            with self.subTest(query=query):
                self.assertTrue(cache.search_brake_pads(query))

    def test_other_symbols_remain_significant_in_both_indexes(self):
        wipers = [
            {"main_part": "AB/123", "alt_parts": "X100", "section": "Front Wipers"},
            {"main_part": "АБ123", "alt_parts": "X200", "section": "Back Wipers"},
        ]
        brakes = [
            {"main_part": "AB/123", "oe_analogue": "AB_456", "not_original": "AB+789"},
        ]
        cache = SearchCache(loader=lambda: snapshot(wipers, brakes))
        self.assertTrue(cache.refresh_once())
        self.assertEqual(cache.search_wipers("ab/123")[0]["main_part"], "AB/123")
        self.assertEqual(cache.search_wipers("аб123")[0]["main_part"], "АБ123")
        for query in ("AB123", "AB456", "AB789", "AB@123"):
            with self.subTest(query=query):
                self.assertEqual(cache.search_wipers(query), [])
                self.assertEqual(cache.search_brake_pads(query), [])
        for query in ("ab/123", "ab_456", "ab+789"):
            with self.subTest(query=query):
                self.assertEqual(cache.search_brake_pads(query)[0]["main_part"], "AB/123")


class SearchCacheTests(unittest.TestCase):
    def test_snapshot_serves_wipers_brake_pads_and_prefixes(self):
        cache = SearchCache(loader=snapshot)

        self.assertTrue(cache.refresh_once())
        exact_result = cache.search_wipers("W1-ALT")[0]
        self.assertEqual(exact_result["main_part"], "WIPER-100")
        self.assertEqual(exact_result["all_parts"], ["W1ALT", "WIPER-100"])
        self.assertEqual(
            [group["main_part"] for group in cache.search_wipers("W1-ALT")],
            ["WIPER-100", "WIPER-200"],
        )
        self.assertEqual(
            [group["main_part"] for group in cache.search_wiper_prefix("wip")],
            ["WIPER-100", "WIPER-200"],
        )
        self.assertEqual(
            cache.search_wiper_prefix("W1A")[0]["all_parts"],
            ["W1ALT", "WIPER-100"],
        )
        brake_result = cache.search_brake_pads("P-ALT")[0]
        self.assertEqual(brake_result["main_part"], "PAD-200")
        self.assertEqual(brake_result["oe_analogue"], "P-ALT")
        self.assertEqual(brake_result["not_original"], "P-SECOND")

    def test_failed_refresh_keeps_full_last_known_good_snapshot(self):
        cache = SearchCache(loader=snapshot)
        cache.refresh_once()
        cache._loader = lambda: (_ for _ in ()).throw(RuntimeError("Google unavailable"))

        self.assertFalse(cache.refresh_once())
        self.assertEqual(cache.search_wipers("W1-ALT")[0]["main_part"], "WIPER-100")
        self.assertEqual(cache.search_brake_pads("P-ALT")[0]["main_part"], "PAD-200")
        self.assertEqual(cache.status()["refresh_error"], "Не удалось обновить данные Google Sheets")

    def test_search_is_unavailable_before_first_successful_refresh(self):
        cache = SearchCache(loader=snapshot)

        self.assertIsNone(cache.search_wipers("W-ALT"))
        self.assertIsNone(cache.search_brake_pads("P-ALT"))

    def test_only_one_refresh_runs_at_a_time(self):
        entered = threading.Event()
        release = threading.Event()
        calls = []

        def blocking_loader():
            calls.append("load")
            entered.set()
            release.wait(timeout=1)
            return snapshot()

        cache = SearchCache(loader=blocking_loader)
        refresh_thread = threading.Thread(target=cache.refresh_once)
        refresh_thread.start()
        self.assertTrue(entered.wait(timeout=1))
        self.assertFalse(cache.refresh_once())
        release.set()
        refresh_thread.join(timeout=1)
        self.assertEqual(calls, ["load"])

    def test_any_unreadable_worksheet_rejects_the_complete_snapshot(self):
        class Worksheet:
            def __init__(self, title, rows=None, error=None):
                self.title = title
                self._rows = rows
                self._error = error

            def get_all_values(self):
                if self._error:
                    raise self._error
                return self._rows

        class Spreadsheet:
            def worksheets(self):
                return [
                    Worksheet("Wipers", [["Front Wipers"], ["WIPER-100", "W1ALT"]]),
                    Worksheet("Brake Pads", error=RuntimeError("temporary Google error")),
                ]

        class Client:
            def open_by_key(self, _spreadsheet_id):
                return Spreadsheet()

        with patch("app._get_google_credentials", return_value=object()), patch(
            "app.gspread.authorize", return_value=Client()
        ), patch.dict("os.environ", {"GOOGLE_SHEETS_ID": "test-sheet"}, clear=False):
            with self.assertRaisesRegex(RuntimeError, "Brake Pads"):
                get_all_google_sheets_data()
