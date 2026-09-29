import json
import logging
import os
import re
import threading
from collections import OrderedDict, defaultdict
from datetime import datetime, timezone
from types import MappingProxyType

import gspread
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from google.oauth2.service_account import Credentials


load_dotenv()
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]
DEFAULT_REFRESH_SECONDS = 180
WIPER_SHEET_TERMS = ("brake", "pad", "тормоз")
BRAKE_SHEET_TERMS = ("wiper", "wipe", "щетк")


def utc_now():
    return datetime.now(timezone.utc)


def preprocess_part_number(part_number):
    """Removes a leading V/v, preserving the existing public search behaviour."""
    if not isinstance(part_number, str):
        return ""
    normalized = part_number.strip()
    if normalized[:1].lower() == "v":
        normalized = normalized[1:]
    return normalized


def normalize_token_for_match(value):
    """Matches the existing wiper normalization: uppercase ASCII alphanumerics only."""
    if not isinstance(value, str):
        return ""
    return re.sub(r"[^A-Za-z0-9]", "", value).upper().strip()


def _get_google_credentials():
    service_account_key = os.getenv("GOOGLE_SERVICE_ACCOUNT_KEY")
    if service_account_key:
        return Credentials.from_service_account_info(
            json.loads(service_account_key), scopes=SCOPES
        )

    service_account_file = os.getenv(
        "GOOGLE_SERVICE_ACCOUNT_FILE", "service-account-key.json"
    )
    if not os.path.exists(service_account_file):
        raise ValueError(
            "Не задан GOOGLE_SERVICE_ACCOUNT_KEY и не найден файл service account"
        )
    return Credentials.from_service_account_file(service_account_file, scopes=SCOPES)


def _worksheet_rows():
    """Returns all worksheet rows once, refusing to publish a partial spreadsheet read."""
    spreadsheet_id = os.getenv("GOOGLE_SHEETS_ID")
    if not spreadsheet_id:
        raise ValueError("GOOGLE_SHEETS_ID не установлен в переменной окружения")

    client = gspread.authorize(_get_google_credentials())
    spreadsheet = client.open_by_key(spreadsheet_id)
    worksheets = []
    for worksheet in spreadsheet.worksheets():
        try:
            worksheets.append((worksheet.title, worksheet.get_all_values()))
        except Exception as error:
            logger.exception("Не удалось прочитать лист Google Sheets: %s", worksheet.title)
            raise RuntimeError(
                f"Не удалось прочитать лист Google Sheets: {worksheet.title}"
            ) from error
    return worksheets


def _parse_wiper_rows(worksheet_title, rows):
    if any(term in worksheet_title.lower() for term in WIPER_SHEET_TERMS):
        return []

    current_section = None
    parsed = []
    for row in rows:
        if not row or not row[0].strip():
            continue
        first_cell = row[0].strip()
        first_lower = first_cell.lower()
        if "front wipers" in first_lower:
            current_section = "Front Wipers"
        elif "back wipers" in first_lower:
            current_section = "Back Wipers"
        elif len(row) >= 2 and row[1].strip():
            if not any(
                keyword in first_lower
                for keyword in ("wipers", "front", "back", "brake", "pad", "тормоз")
            ) and not any(
                keyword in row[1].lower() for keyword in ("brake", "pad", "тормоз")
            ):
                parsed.append(
                    {
                        "main_part": first_cell,
                        "alt_parts": row[1].strip(),
                        "section": current_section,
                    }
                )
    return parsed


def _parse_brake_pad_rows(worksheet_title, rows):
    worksheet_title_lower = worksheet_title.lower()
    if any(term in worksheet_title_lower for term in BRAKE_SHEET_TERMS):
        return []

    if "front" in worksheet_title_lower and (
        "brake" in worksheet_title_lower or "pad" in worksheet_title_lower
    ):
        current_section = "Front Brake Pads"
    elif ("back" in worksheet_title_lower or "rear" in worksheet_title_lower) and (
        "brake" in worksheet_title_lower or "pad" in worksheet_title_lower
    ):
        current_section = "Rear Brake Pads"
    else:
        current_section = worksheet_title

    parsed = []
    for row in rows:
        if not row or not row[0].strip():
            continue

        first_cell = row[0].strip()
        first_lower = first_cell.lower()
        if current_section == worksheet_title:
            if "front brake" in first_lower or "front pads" in first_lower:
                current_section = "Front Brake Pads"
            elif any(
                marker in first_lower
                for marker in ("back brake", "rear brake", "back pads", "rear pads")
            ):
                current_section = "Rear Brake Pads"

        if len(row) < 3 or not (row[1].strip() or row[2].strip()):
            continue
        if any(
            keyword in first_lower
            for keyword in (
                "brake",
                "pads",
                "front",
                "back",
                "rear",
                "part number",
                "oe analogue",
                "not original",
                "wiper",
                "wipe",
                "щетк",
            )
        ):
            continue
        if any(
            keyword in row[1].lower() or keyword in row[2].lower()
            for keyword in BRAKE_SHEET_TERMS
        ):
            continue
        parsed.append(
            {
                "main_part": first_cell,
                "oe_analogue": row[1].strip(),
                "not_original": row[2].strip(),
                "section": current_section,
            }
        )
    return parsed


def get_all_google_sheets_data():
    """Loads both data sets from one complete Google Sheets snapshot."""
    wiper_data = []
    brake_pads_data = []
    for worksheet_title, rows in _worksheet_rows():
        wiper_data.extend(_parse_wiper_rows(worksheet_title, rows))
        brake_pads_data.extend(_parse_brake_pad_rows(worksheet_title, rows))
    return wiper_data, brake_pads_data


def get_google_sheets_data():
    """Compatibility helper for scripts that inspect wiper data directly."""
    return get_all_google_sheets_data()[0]


def get_brake_pads_data():
    """Compatibility helper for scripts that inspect brake-pad data directly."""
    return get_all_google_sheets_data()[1]


def normalize_data(raw_data):
    """Preserves the existing wiper token filtering and main-part lookup behaviour."""
    normalized_data = []
    for item in raw_data:
        if not isinstance(item, dict) or "main_part" not in item or "alt_parts" not in item:
            continue
        main_part = item["main_part"]
        alt_parts_str = item["alt_parts"]
        section = item.get("section", "Unknown")
        if not main_part or not alt_parts_str:
            continue

        alt_parts_clean = re.sub(r"\([^)]*\)", "", alt_parts_str)
        normalized_data.append(
            {"main_part": main_part, "alt_part": main_part, "section": section}
        )
        for token in re.split(r"[/,\s]+", alt_parts_clean):
            token = token.strip()
            if not token or not re.fullmatch(r"[A-Za-z0-9]+", token):
                continue
            if not re.search(r"\d", token):
                continue
            normalized_data.append(
                {"main_part": main_part, "alt_part": token, "section": section}
            )
    return normalized_data


def normalize_brake_pads_data(raw_data):
    """Preserves OE and Not Original fields required by the brake-pad page."""
    normalized_data = []
    for item in raw_data:
        if not isinstance(item, dict) or not item.get("main_part"):
            continue
        main_part = item["main_part"]
        oe_analogue = item.get("oe_analogue", "")
        not_original = item.get("not_original", "")
        section = item.get("section", "Unknown")
        for alt_part in (main_part, oe_analogue, not_original):
            if alt_part:
                normalized_data.append(
                    {
                        "main_part": main_part,
                        "alt_part": alt_part,
                        "section": section,
                        "oe_analogue": oe_analogue,
                        "not_original": not_original,
                    }
                )
    return normalized_data


def _build_wiper_indexes(normalized_data):
    groups = OrderedDict()
    for item in normalized_data:
        main_part = item["main_part"]
        group = groups.setdefault(
            main_part,
            {"main_part": main_part, "section": item.get("section", "Unknown"), "parts": set()},
        )
        group["parts"].add(main_part)
        group["parts"].add(item["alt_part"])

    exact_index = defaultdict(list)
    prefix_index = defaultdict(list)
    for group in groups.values():
        result_group = MappingProxyType(
            {
                "main_part": group["main_part"],
                "all_parts": tuple(sorted(group["parts"])),
                "section": group["section"],
            }
        )
        for part in group["parts"]:
            token = normalize_token_for_match(part)
            if token:
                exact_index[token].append(result_group)
            if len(token) >= 3:
                prefix_index[token[:3]].append(result_group)

    def freeze(index):
        frozen = {}
        for key, values in index.items():
            unique = []
            seen = set()
            for group in values:
                if group["main_part"] not in seen:
                    seen.add(group["main_part"])
                    unique.append(group)
            frozen[key] = tuple(unique)
        return MappingProxyType(frozen)

    return freeze(exact_index), freeze(prefix_index)


def _public_wiper_results(groups):
    return [
        {
            "main_part": group["main_part"],
            "all_parts": list(group["all_parts"]),
            "section": group["section"],
        }
        for group in groups
    ]


def _build_brake_index(normalized_data):
    groups = OrderedDict()
    for item in normalized_data:
        main_part = item["main_part"]
        groups.setdefault(
            main_part,
            MappingProxyType(
                {
                    "main_part": main_part,
                    "section": item.get("section", "Unknown"),
                    "oe_analogue": item.get("oe_analogue", ""),
                    "not_original": item.get("not_original", ""),
                }
            ),
        )

    index = defaultdict(list)
    for item in normalized_data:
        token = item["alt_part"].upper().strip()
        if token:
            group = groups[item["main_part"]]
            if group not in index[token]:
                index[token].append(group)
    return MappingProxyType({key: tuple(value) for key, value in index.items()})


def _public_brake_results(groups):
    return [
        {
            "main_part": group["main_part"],
            "section": group["section"],
            "oe_analogue": group["oe_analogue"],
            "not_original": group["not_original"],
        }
        for group in groups
    ]


def search_analogs(part_number, data):
    exact_index, _ = _build_wiper_indexes(data)
    return _public_wiper_results(exact_index.get(normalize_token_for_match(part_number), ()))


def search_by_prefix(part_prefix, data):
    _, prefix_index = _build_wiper_indexes(data)
    token = normalize_token_for_match(part_prefix)
    if len(token) < 3:
        return []
    return _public_wiper_results(prefix_index.get(token[:3], ()))


def search_brake_pads_analogs(part_number, data):
    index = _build_brake_index(data)
    return _public_brake_results(index.get(part_number.upper().strip(), ()))


def load_search_snapshot():
    wiper_raw_data, brake_raw_data = get_all_google_sheets_data()
    wiper_normalized_data = normalize_data(wiper_raw_data)
    brake_normalized_data = normalize_brake_pads_data(brake_raw_data)
    if not wiper_normalized_data and not brake_normalized_data:
        raise ValueError("Google Sheets вернул пустой поисковый снимок")
    wiper_exact, wiper_prefix = _build_wiper_indexes(wiper_normalized_data)
    return MappingProxyType(
        {
            "wiper_exact": wiper_exact,
            "wiper_prefix": wiper_prefix,
            "brake_exact": _build_brake_index(brake_normalized_data),
            "wiper_raw_count": len(wiper_raw_data),
            "wiper_normalized_count": len(wiper_normalized_data),
            "brake_raw_count": len(brake_raw_data),
            "brake_normalized_count": len(brake_normalized_data),
        }
    )


class SearchCache:
    """Atomically publishes full, last-known-good wiper and brake-pad snapshots."""

    def __init__(self, loader=load_search_snapshot, refresh_seconds=DEFAULT_REFRESH_SECONDS):
        self._loader = loader
        self._refresh_seconds = refresh_seconds
        self._state_lock = threading.Lock()
        self._refresh_lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread = None
        self._snapshot = None
        self._last_success_at = None
        self._last_attempt_at = None
        self._last_error = None

    def start(self):
        with self._state_lock:
            if self._thread and self._thread.is_alive():
                return
            self._thread = threading.Thread(
                target=self._refresh_loop,
                name="google-sheets-search-refresh",
                daemon=True,
            )
            self._thread.start()

    def _refresh_loop(self):
        while not self._stop_event.is_set():
            self.refresh_once()
            self._stop_event.wait(self._refresh_seconds)

    def refresh_once(self):
        if not self._refresh_lock.acquire(blocking=False):
            return False
        attempt_at = utc_now()
        try:
            snapshot = self._loader()
        except Exception:
            logger.exception("Не удалось обновить поисковый кеш Google Sheets")
            with self._state_lock:
                self._last_attempt_at = attempt_at
                self._last_error = "Не удалось обновить данные Google Sheets"
            return False
        finally:
            self._refresh_lock.release()

        with self._state_lock:
            self._snapshot = snapshot
            self._last_attempt_at = attempt_at
            self._last_success_at = utc_now()
            self._last_error = None
        logger.info(
            "Поисковый кеш обновлён: дворники %s/%s, колодки %s/%s",
            snapshot["wiper_raw_count"],
            snapshot["wiper_normalized_count"],
            snapshot["brake_raw_count"],
            snapshot["brake_normalized_count"],
        )
        return True

    def _current_snapshot(self):
        with self._state_lock:
            return self._snapshot

    def search_wipers(self, part_number):
        snapshot = self._current_snapshot()
        if snapshot is None:
            return None
        return _public_wiper_results(
            snapshot["wiper_exact"].get(normalize_token_for_match(part_number), ())
        )

    def search_wiper_prefix(self, part_prefix):
        snapshot = self._current_snapshot()
        if snapshot is None:
            return None
        token = normalize_token_for_match(part_prefix)
        if len(token) < 3:
            return []
        return _public_wiper_results(snapshot["wiper_prefix"].get(token[:3], ()))

    def search_brake_pads(self, part_number):
        snapshot = self._current_snapshot()
        if snapshot is None:
            return None
        return _public_brake_results(snapshot["brake_exact"].get(part_number.upper().strip(), ()))

    def has_wiper_data(self):
        snapshot = self._current_snapshot()
        return bool(snapshot and snapshot["wiper_raw_count"])

    def has_brake_pad_data(self):
        snapshot = self._current_snapshot()
        return bool(snapshot and snapshot["brake_raw_count"])

    def status(self):
        with self._state_lock:
            snapshot = self._snapshot
            return {
                "cache_ready": snapshot is not None,
                "last_success_at": self._last_success_at.isoformat()
                if self._last_success_at
                else None,
                "last_attempt_at": self._last_attempt_at.isoformat()
                if self._last_attempt_at
                else None,
                "wiper_record_count": snapshot["wiper_raw_count"] if snapshot else 0,
                "brake_pad_record_count": snapshot["brake_raw_count"] if snapshot else 0,
                "refresh_error": self._last_error,
            }


def _refresh_seconds_from_environment():
    value = os.getenv("SHEETS_REFRESH_SECONDS", str(DEFAULT_REFRESH_SECONDS))
    try:
        return max(30, int(value))
    except ValueError:
        logger.warning("Некорректный SHEETS_REFRESH_SECONDS=%r", value)
        return DEFAULT_REFRESH_SECONDS


def _cache_unavailable_response():
    return jsonify({"error": "Search database is still loading. Please try again shortly."}), 503


def create_app(cache=None, start_cache_on_request=True):
    flask_app = Flask(__name__)
    search_cache = cache or SearchCache(refresh_seconds=_refresh_seconds_from_environment())
    flask_app.extensions["search_cache"] = search_cache

    if start_cache_on_request:

        @flask_app.before_request
        def start_search_cache():
            search_cache.start()

    @flask_app.route("/")
    def index():
        return render_template("index.html")

    @flask_app.route("/brake-pads")
    def brake_pads():
        return render_template("brake_pads.html")

    @flask_app.route("/search", methods=["POST"])
    def search():
        data = request.get_json(silent=True) or {}
        part_number = preprocess_part_number(data.get("part_number", ""))
        if not part_number:
            return jsonify({"error": "Part number not specified"}), 400

        results = search_cache.search_wipers(part_number)
        if results is None:
            return _cache_unavailable_response()
        if not search_cache.has_wiper_data():
            return jsonify({"error": "Failed to get data from table"}), 500
        if not results and len(part_number.strip()) >= 3:
            prefix_results = search_cache.search_wiper_prefix(part_number)
            if prefix_results:
                return jsonify(
                    {
                        "message": f'Found results for prefix "{part_number[:3].upper()}":',
                        "results": prefix_results,
                    }
                )
        if not results:
            return jsonify(
                {
                    "message": f'Part number "{part_number}" not found in database',
                    "results": [],
                }
            )
        return jsonify(
            {
                "message": f'Found analogs for part number "{part_number}":',
                "results": results,
            }
        )

    @flask_app.route("/search-prefix", methods=["POST"])
    def search_prefix():
        data = request.get_json(silent=True) or {}
        part_prefix = preprocess_part_number(data.get("part_prefix", ""))
        if not part_prefix or len(part_prefix.strip()) < 3:
            return jsonify({"error": "Part prefix must be at least 3 characters"}), 400
        results = search_cache.search_wiper_prefix(part_prefix)
        if results is None:
            return _cache_unavailable_response()
        if not search_cache.has_wiper_data():
            return jsonify({"error": "Failed to get data from table"}), 500
        if not results:
            return jsonify(
                {"message": f'No results for prefix "{part_prefix[:3].upper()}"', "results": []}
            )
        return jsonify(
            {
                "message": f'Found results for prefix "{part_prefix[:3].upper()}":',
                "results": results,
            }
        )

    @flask_app.route("/search-brake-pads", methods=["POST"])
    def search_brake_pads():
        data = request.get_json(silent=True) or {}
        part_number = preprocess_part_number(data.get("part_number", ""))
        if not part_number:
            return jsonify({"error": "Part number not specified"}), 400
        results = search_cache.search_brake_pads(part_number)
        if results is None:
            return _cache_unavailable_response()
        if not search_cache.has_brake_pad_data():
            return jsonify({"error": "Failed to get data from table"}), 500
        if not results:
            return jsonify(
                {
                    "message": f'Part number "{part_number}" not found in database',
                    "results": [],
                }
            )
        return jsonify(
            {
                "message": f'Found analogs for part number "{part_number}":',
                "results": results,
            }
        )

    @flask_app.route("/health")
    def health():
        environment_variables = {
            "GOOGLE_SHEETS_ID": bool(os.getenv("GOOGLE_SHEETS_ID")),
            "GOOGLE_SERVICE_ACCOUNT_KEY": bool(os.getenv("GOOGLE_SERVICE_ACCOUNT_KEY")),
        }
        return jsonify(
            {
                "status": "ok",
                "environment_variables": environment_variables,
                "message": "Application is running",
                **search_cache.status(),
            }
        )

    return flask_app


app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(debug=False, host="0.0.0.0", port=port)
