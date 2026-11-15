#!/usr/bin/env python3
"""Povlači prognoze s Open-Meteoa za lokacije iz lokacije.json i sprema ih kao JSON.

Pokreće se iz GitHub Actions (.github/workflows/prognoze.yml). Bez vanjskih paketa.
Upotreba: python3 dohvati.py <izlazna_mapa>
"""

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

OVDJE = Path(__file__).resolve().parent

HOURLY = [
    "temperature_2m", "dew_point_2m", "relative_humidity_2m", "precipitation",
    "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m", "cloud_cover",
    "shortwave_radiation", "pressure_msl",
]
DAILY = [
    "temperature_2m_max", "temperature_2m_min", "precipitation_sum", "precipitation_hours",
    "wind_speed_10m_max", "wind_gusts_10m_max", "wind_direction_10m_dominant",
]
ENS_DAILY = [
    "temperature_2m_max", "temperature_2m_min", "precipitation_sum", "wind_gusts_10m_max",
]

# (naziv datoteke, osnovna adresa, putanja, dodatni parametri)
IZVORI = [
    ("ecmwf_hres", "https://api.open-meteo.com", "/v1/ecmwf",
     {"models": "ecmwf_ifs", "forecast_days": 15, "hourly": HOURLY, "daily": DAILY}),
    ("icon_d2", "https://api.open-meteo.com", "/v1/dwd-icon",
     {"models": "icon_d2", "forecast_days": 3, "hourly": HOURLY, "daily": DAILY}),
    ("icon_2i", "https://api.open-meteo.com", "/v1/forecast",
     {"models": "italia_meteo_arpae_icon_2i", "forecast_days": 3, "hourly": HOURLY, "daily": DAILY}),
    ("ecmwf_ansambl", "https://ensemble-api.open-meteo.com", "/v1/ensemble",
     {"models": "ecmwf_ifs025_ensemble", "forecast_days": 15, "daily": ENS_DAILY}),
]
MORE = ("more", "https://marine-api.open-meteo.com", "/v1/marine",
        {"cell_selection": "sea", "forecast_days": 7,
         "hourly": ["sea_surface_temperature", "wave_height", "wave_direction", "wave_period"]})

CEKANJA = [5, 20, 45]  # sekunde između ponovnih pokušaja


def dohvati(baza: str, putanja: str, params: dict) -> dict:
    upit = {k: ",".join(v) if isinstance(v, list) else v for k, v in params.items()}
    url = f"{baza}{putanja}?{urllib.parse.urlencode(upit)}"
    zahtjev = urllib.request.Request(url, headers={"User-Agent": "markosvircic-prognoze/1.0"})
    for pokusaj in range(len(CEKANJA) + 1):
        try:
            with urllib.request.urlopen(zahtjev, timeout=60) as odgovor:
                return json.load(odgovor)
        except urllib.error.HTTPError as e:
            tijelo = e.read().decode("utf-8", "replace")
            dnevno = e.code == 429 and ("Daily" in tijelo or "Hourly" in tijelo)
            ponovi = (e.code == 429 and not dnevno) or e.code >= 500
            if not ponovi or pokusaj == len(CEKANJA):
                raise RuntimeError(f"HTTP {e.code}: {tijelo[:300]}") from None
        except (urllib.error.URLError, TimeoutError) as e:
            if pokusaj == len(CEKANJA):
                raise RuntimeError(f"Mrežna greška: {e}") from None
        time.sleep(CEKANJA[pokusaj])
    raise AssertionError("nedostižno")


def main() -> int:
    izlaz = Path(sys.argv[1] if len(sys.argv) > 1 else "podaci")
    lokacije = json.loads((OVDJE / "lokacije.json").read_text(encoding="utf-8"))
    sada = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    meta = {"dohvaceno_utc": sada, "lokacije": {}, "greske": []}

    for lok in lokacije:
        mapa = izlaz / lok["id"]
        mapa.mkdir(parents=True, exist_ok=True)
        izvori = IZVORI + ([MORE] if lok.get("more") else [])
        stanje = {}
        for ime, baza, putanja, extra in izvori:
            params = {"latitude": lok["lat"], "longitude": lok["lon"], "timezone": "Europe/Zagreb", **extra}
            try:
                podaci = dohvati(baza, putanja, params)
                podaci["_dohvaceno_utc"] = sada
                (mapa / f"{ime}.json").write_text(json.dumps(podaci, ensure_ascii=False), encoding="utf-8")
                stanje[ime] = "ok"
            except Exception as e:  # jedna greška ne smije srušiti ostale lokacije
                stanje[ime] = f"greška: {e}"
                meta["greske"].append(f"{lok['id']}/{ime}: {e}")
            time.sleep(1)
        meta["lokacije"][lok["id"]] = {**lok, "izvori": stanje}

    (izlaz / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    ukupno = sum(len(v["izvori"]) for v in meta["lokacije"].values())
    return 1 if len(meta["greske"]) == ukupno else 0  # neuspjeh samo ako ništa nije prošlo


if __name__ == "__main__":
    sys.exit(main())
