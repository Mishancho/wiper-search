import unittest

from app import (
    SearchCache,
    _build_brake_index,
    _build_wiper_indexes,
    create_app,
    normalize_brake_pads_data,
    normalize_data,
)


def snapshot():
    wiper_raw = [
        {"main_part": "WIPER-100", "alt_parts": "W1ALT", "section": "Front Wipers"},
        {"main_part": "2GM-900", "alt_parts": "2GM-ALT", "section": "Back Wipers"},
    ]
    brake_raw = [
        {
            "main_part": "PAD-200",
            "oe_analogue": "P-ALT",
            "not_original": "P-SECOND",
            "section": "Front Brake Pads",
        }
    ]
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


class SearchEndpointTests(unittest.TestCase):
    def setUp(self):
        self.calls = 0

        def loader():
            self.calls += 1
            return snapshot()

        self.cache = SearchCache(loader=loader)
        self.assertTrue(self.cache.refresh_once())
        self.app = create_app(cache=self.cache, start_cache_on_request=False)
        self.client = self.app.test_client()

    def test_wiper_exact_and_prefix_search_use_cached_snapshot(self):
        exact_response = self.client.post("/search", json={"part_number": "v w1-alt"})
        prefix_response = self.client.post("/search-prefix", json={"part_prefix": "2gm-extra"})

        self.assertEqual(exact_response.status_code, 200)
        self.assertEqual(prefix_response.status_code, 200)
        self.assertEqual(exact_response.get_json()["results"][0]["main_part"], "WIPER-100")
        self.assertEqual(
            exact_response.get_json()["results"][0]["all_parts"],
            ["W1ALT", "WIPER-100"],
        )
        self.assertEqual(prefix_response.get_json()["results"][0]["main_part"], "2GM-900")
        self.assertEqual(self.calls, 1)

    def test_brake_pad_search_preserves_oe_and_not_original_fields(self):
        response = self.client.post("/search-brake-pads", json={"part_number": "P-ALT"})

        self.assertEqual(response.status_code, 200)
        result = response.get_json()["results"][0]
        self.assertEqual(result["main_part"], "PAD-200")
        self.assertEqual(result["oe_analogue"], "P-ALT")
        self.assertEqual(result["not_original"], "P-SECOND")
        self.assertEqual(self.calls, 1)

    def test_searches_ignore_separators_and_case_but_keep_response_spelling(self):
        for endpoint, query, expected in (
            (
                "/search",
                "w i.p-e r 1.00",
                {
                    "main_part": "WIPER-100",
                    "all_parts": ["W1ALT", "WIPER-100"],
                    "section": "Front Wipers",
                },
            ),
            (
                "/search-brake-pads",
                "p .a-l t",
                {
                    "main_part": "PAD-200",
                    "oe_analogue": "P-ALT",
                    "not_original": "P-SECOND",
                    "section": "Front Brake Pads",
                },
            ),
        ):
            with self.subTest(endpoint=endpoint):
                response = self.client.post(endpoint, json={"part_number": query})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    response.get_json(),
                    {
                        "message": f'Found analogs for part number "{query}":',
                        "results": [expected],
                    },
                )

    def test_empty_results_keep_current_response_contract(self):
        for endpoint in ("/search", "/search-brake-pads"):
            with self.subTest(endpoint=endpoint):
                response = self.client.post(endpoint, json={"part_number": "ZZZ-999"})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    response.get_json(),
                    {
                        "message": 'Part number "ZZZ-999" not found in database',
                        "results": [],
                    },
                )

    def test_search_returns_503_while_initial_snapshot_is_loading(self):
        cold_cache = SearchCache(loader=snapshot)
        app = create_app(cache=cold_cache, start_cache_on_request=False)

        for endpoint in ("/search", "/search-brake-pads"):
            with self.subTest(endpoint=endpoint):
                response = app.test_client().post(endpoint, json={"part_number": "P-ALT"})
                self.assertEqual(response.status_code, 503)
                self.assertEqual(
                    response.get_json(),
                    {"error": "Search database is still loading. Please try again shortly."},
                )

    def test_health_reports_cache_status_without_refreshing(self):
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["cache_ready"])
        self.assertEqual(self.calls, 1)

    def test_invalid_part_numbers_are_rejected(self):
        self.assertEqual(self.client.post("/search", json={"part_number": "  "}).status_code, 400)
        self.assertEqual(
            self.client.post("/search-prefix", json={"part_prefix": "2G"}).status_code,
            400,
        )
