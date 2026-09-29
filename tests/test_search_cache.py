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


def snapshot():
    wiper_normalized = normalize_data(WIPER_RAW_DATA)
    brake_normalized = normalize_brake_pads_data(BRAKE_RAW_DATA)
    wiper_exact, wiper_prefix = _build_wiper_indexes(wiper_normalized)
    return {
        "wiper_exact": wiper_exact,
        "wiper_prefix": wiper_prefix,
        "brake_exact": _build_brake_index(brake_normalized),
        "wiper_raw_count": len(WIPER_RAW_DATA),
        "wiper_normalized_count": len(wiper_normalized),
        "brake_raw_count": len(BRAKE_RAW_DATA),
        "brake_normalized_count": len(brake_normalized),
    }


class SearchCacheTests(unittest.TestCase):
    def test_snapshot_serves_wipers_brake_pads_and_prefixes(self):
        cache = SearchCache(loader=snapshot)

        self.assertTrue(cache.refresh_once())
        self.assertEqual(cache.search_wipers("W1-ALT")[0]["main_part"], "WIPER-100")
        self.assertEqual(
            [group["main_part"] for group in cache.search_wipers("W1-ALT")],
            ["WIPER-100", "WIPER-200"],
        )
        self.assertEqual(
            [group["main_part"] for group in cache.search_wiper_prefix("wip")],
            ["WIPER-100", "WIPER-200"],
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
