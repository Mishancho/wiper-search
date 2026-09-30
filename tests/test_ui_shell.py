import json
import unittest
from html.parser import HTMLParser
from pathlib import Path

from app import create_app


class PageElements(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.by_id = {}
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            self.by_id[attrs["id"]] = (tag, attrs)


class RussianInterfaceShellTests(unittest.TestCase):
    def setUp(self):
        self.client = create_app(start_cache_on_request=False).test_client()

    def test_both_categories_render_russian_accessible_shell(self):
        for path, endpoint in (("/", "/search"), ("/brake-pads", "/search-brake-pads")):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                html = response.get_data(as_text=True)
                self.assertIn('<html lang="ru">', html)
                self.assertIn("Дворники и тормозные колодки", html)
                self.assertIn("Данные автоматически обновляются из Google Sheets", html)
                self.assertNotIn("user-scalable=no", html)
                self.assertNotIn("Wiper Blades Search", html)
                self.assertNotIn("Brake Pads Search", html)
                elements = PageElements(html).by_id
                self.assertEqual(elements["searchForm"][1]["data-search-endpoint"], endpoint)
                self.assertEqual(elements["searchBtn"][1]["type"], "submit")
                self.assertEqual(elements["partNumber"][1]["aria-describedby"], "searchTips")
                self.assertIn('for="partNumber"', html)
                for section in ("favorites", "recent", "notFound"):
                    self.assertIn("hidden", elements[section][1])
                    self.assertIn(section + "Content", elements)
                self.assertEqual(elements["notFound"][0], "details")
                self.assertEqual(elements["notifications"][1]["role"], "status")
                self.assertEqual(elements["notifications"][1]["aria-live"], "polite")
                self.assertEqual(elements["copyStatus"][1]["role"], "status")
                self.assertEqual(elements["copyStatus"][1]["aria-live"], "polite")
                self.assertEqual(elements["error"][1]["role"], "alert")

    def test_manifest_describes_both_categories_in_russian(self):
        root = Path(__file__).resolve().parents[1]
        manifest = json.loads((root / "static/manifest.json").read_text())
        self.assertEqual(manifest["lang"], "ru")
        self.assertIn("дворников", manifest["name"])
        self.assertIn("тормозных колодок", manifest["name"])
