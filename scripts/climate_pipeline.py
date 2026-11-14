#!/usr/bin/env python3
"""
EarthTrends · Pipeline de datos NASA -> JSON para la web.

Lee todos los .nc / .nc4 de /raw-data (recursivo), detecta la variable de
cada archivo (Precipitación GPM / Temperatura MERRA-2 / Agua SWOT-GRACE),
une automáticamente los tramos de años divididos en varios archivos,
promedia a una grilla global común, agrega a series anuales 2005-2025,
corre el test de Mann-Kendall (pymannkendall) celda por celda y exporta
JSONs compactos en /public/data.

Uso:
    .venv/bin/python scripts/climate_pipeline.py                 # datos reales de raw-data/
    .venv/bin/python scripts/climate_pipeline.py --scan          # solo listar qué detecta
    .venv/bin/python scripts/climate_pipeline.py --mock          # JSON de prueba (mismo esquema)
    .venv/bin/python scripts/climate_pipeline.py --res 2 --test hamed_rao

Forzar a qué capa va un archivo:
    - Ponerlo en una subcarpeta raw-data/precip/, raw-data/temp/ o raw-data/water/
    - o pasar --var precip=NOMBRE_VARIABLE (ej. --var temp=M2TMNXSLV_5_12_4_T2M)
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import warnings
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import viz_export  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "raw-data"
OUT_DIR = ROOT / "public" / "data"

SCHEMA_LAYER = "climate-mirror/layer@1"
SCHEMA_META = "climate-mirror/meta@1"

# ---------------------------------------------------------------------------
# Definición de capas
# ---------------------------------------------------------------------------
LAYERS = {
    "precip": {
        "label": "Precipitación",
        "product": "NASA GPM IMERG Monthly (GPM_3IMERGM)",
        "units": "mm/año",
        "scale": 1,  # valor guardado = round(valor * scale)
        "agg": "mean_rate",
        "pattern": r"precip|imerg|prcp|rain|^pr$|^pre$|^tp$",
    },
    "temp": {
        "label": "Temperatura",
        "product": "NASA MERRA-2 T2M (M2TMNXSLV)",
        "units": "°C",
        "scale": 10,  # 0.1 °C (el test MK se corre con valores sin redondear)
        "agg": "mean",
        "pattern": r"t2m|^tas$|^tmp$|^temp|temperature|^tavg|^t$",
    },
    "water": {
        "label": "Agua (GRACE-FO)",
        "product": "GRACE/GRACE-FO JPL Mascon RL06.3 CRI · agua terrestre total (cm eq.)",
        "units": "cm",
        "scale": 10,
        "agg": "mean",
        "land_only": True,  # GRACE también mide el océano (nivel del mar): solo usamos continentes
        "viz_smooth_deg": 0.25,  # GRACE mascons ~3°: suavizado leve de bordes (los datos/estadísticas no)
        "pattern": r"lwe|^wse|water_surface|water_level|^tws|terrestrial_water|^height$|^level$",
    },
}
LAYERS["stars"] = {
    "label": "Star visibility",
    "product": "NASA MERRA-2 M2TMNXRAD v5.12.4 · clear-sky fraction = 1 − CLDTOT (total cloud area fraction)",
    "units": "% clear sky",
    "scale": 10,
    "agg": "mean",
    "pattern": r"cldtot|cloud_fraction|clear_sky",
}
LAYER_ORDER = ["precip", "temp", "water", "stars"]

LAT_NAMES = ("lat", "latitude", "y", "nav_lat", "Latitude")
LON_NAMES = ("lon", "longitude", "x", "nav_lon", "Longitude")
TIME_NAMES = ("time", "t", "date", "TIME")


def log(msg: str) -> None:
    print(msg, flush=True)


# ---------------------------------------------------------------------------
# Grilla destino
# ---------------------------------------------------------------------------
class Grid:
    def __init__(self, res: float):
        self.res = float(res)
        self.nlat = int(round(180 / res))
        self.nlon = int(round(360 / res))
        self.lat = -90 + res / 2 + np.arange(self.nlat) * res
        self.lon = -180 + res / 2 + np.arange(self.nlon) * res

    def to_json(self) -> dict:
        return {
            "res": self.res,
            "nlat": self.nlat,
            "nlon": self.nlon,
            "lat0": round(float(self.lat[0]), 4),
            "lon0": round(float(self.lon[0]), 4),
            "order": "cell = ilat * nlon + ilon (lat ascendente, lon ascendente)",
        }


def land_mask(grid: Grid) -> np.ndarray:
    """Máscara tierra (True) por celda, rasterizando public/assets/countries.geojson (Natural Earth)."""
    from PIL import Image, ImageDraw

    gj = json.loads((ROOT / "public" / "assets" / "countries.geojson").read_text())
    ss = 4  # sobre-muestreo para que las costas cubran celdas parciales
    W, H = grid.nlon * ss, grid.nlat * ss
    img = Image.new("L", (W, H), 0)
    draw = ImageDraw.Draw(img)

    def ring_xy(ring):
        return [((lon + 180) / 360 * W, (90 - lat) / 180 * H) for lon, lat in ring]

    for f in gj["features"]:
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for poly in polys:
            draw.polygon(ring_xy(poly[0]), fill=1)
            for hole in poly[1:]:
                draw.polygon(ring_xy(hole), fill=0)
    a = np.asarray(img, dtype=np.float32).reshape(grid.nlat, ss, grid.nlon, ss).mean(axis=(1, 3))
    return (a[::-1] >= 0.25).reshape(-1)  # fila 0 = sur, como la grilla


# ---------------------------------------------------------------------------
# Lectura y normalización de NetCDF
# ---------------------------------------------------------------------------
def _find_coord(ds, names):
    for n in names:
        if n in ds.coords or n in ds.dims or n in ds.variables:
            return n
    return None


def _date_from_attrs_or_name(ds, path: Path):
    for key in ("time_coverage_start", "start_time", "RangeBeginningDate", "begin_date", "date"):
        val = ds.attrs.get(key)
        if val:
            m = re.search(r"(\d{4})-?(\d{2})", str(val))
            if m:
                return int(m.group(1)), int(m.group(2))
    m = re.search(r"(19|20)(\d{2})(0[1-9]|1[0-2])", path.name)  # YYYYMM / YYYYMMDD
    if m:
        return int(m.group(1) + m.group(2)), int(m.group(3))
    m = re.search(r"(?<!\d)(19|20)(\d{2})(?!\d)", path.name)  # YYYY
    if m:
        return int(m.group(1) + m.group(2)), 7
    return None


def classify_variable(name: str, ds_var, forced: dict, folder_hint: str | None):
    for layer, varname in forced.items():
        if name == varname:
            return layer
    if folder_hint in LAYERS:
        return folder_hint
    probe = [name.lower(), str(ds_var.attrs.get("standard_name", "")).lower(), str(ds_var.attrs.get("long_name", "")).lower()]
    for layer in LAYER_ORDER:
        pat = re.compile(LAYERS[layer]["pattern"])
        # Nombres tipo Giovanni: GPM_3IMERGM_07_precipitation -> probar cada token final
        tokens = [p for s in probe for p in [s, s.split("_")[-1]]]
        if any(pat.search(t) for t in tokens if t):
            return layer
    return None


def open_any(path: Path, group: str | None = None):
    """Abre .nc / .nc4 / .HDF5. Si el grupo raíz no tiene variables (ej. IMERG crudo), prueba el grupo 'Grid'."""
    import xarray as xr

    last = None
    for engine in ("netcdf4", "h5netcdf", None):
        try:
            kw = {"group": group} if group else {}
            ds = xr.open_dataset(path, engine=engine, use_cftime=True, mask_and_scale=True, **kw)
            if not group and not ds.data_vars:
                ds.close()
                return open_any(path, "Grid")
            return ds
        except Exception as exc:  # noqa: BLE001
            last = exc
    raise RuntimeError(f"No se pudo abrir {path.name}: {last}")


def scan_files(raw_dir: Path, forced: dict, quiet: bool = False):
    """Devuelve {layer: {varname: [entries]}} con un entry por archivo (.nc, .nc4, .HDF5)."""
    say = (lambda *_: None) if quiet else log
    found = defaultdict(lambda: defaultdict(list))
    files = sorted(
        p for p in raw_dir.rglob("*")
        if p.suffix.lower() in (".nc", ".nc4", ".netcdf", ".h5", ".hdf5")
        and "_cache" not in p.parts and not p.name.startswith(".")
    )
    if not files:
        say(f"⚠  No hay archivos .nc/.nc4 en {raw_dir}")
    for path in files:
        try:
            ds = open_any(path)
        except RuntimeError as exc:
            say(f"✗ {exc}")
            continue
        lat = _find_coord(ds, LAT_NAMES)
        lon = _find_coord(ds, LON_NAMES)
        if not lat or not lon:
            say(f"✗ {path.name}: sin coordenadas lat/lon reconocibles, se omite")
            continue
        rel = path.relative_to(raw_dir)
        folder_hint = rel.parts[0].lower() if len(rel.parts) > 1 else None
        hits = 0
        for name, var in ds.data_vars.items():
            if lat not in var.dims or lon not in var.dims:
                continue
            layer = classify_variable(name, var, forced, folder_hint)
            if not layer:
                continue
            found[layer][name].append({"path": path, "lat": lat, "lon": lon})
            hits += 1
            say(f"✓ {rel}  →  {layer:6s} ({name}, units='{var.attrs.get('units', '?')}')")
            if folder_hint in LAYERS or layer in forced:
                break
        if not hits:
            say(f"· {rel}: ninguna variable reconocida ({', '.join(ds.data_vars)}) — usá --var capa=NOMBRE")
        ds.close()
    return found


# ---------------------------------------------------------------------------
# Conversión de unidades (por paso de tiempo)
# ---------------------------------------------------------------------------
def unit_converter(layer: str, units: str, sample_mean: float):
    u = (units or "").lower().replace(" ", "").replace("^", "").replace("**", "")
    if layer == "precip":
        # Todo se lleva a mm/día y luego se anualiza (x365.25) como tasa media.
        if any(k in u for k in ("mm/hr", "mmhr-1", "mm/h", "mmh-1", "mmhour")):
            return lambda a, y, m: a * 24.0, "mm/h → mm/año"
        if any(k in u for k in ("kgm-2s-1", "kg/m2/s", "kgm-2/s", "mm/s", "mms-1")):
            return lambda a, y, m: a * 86400.0, "kg m-2 s-1 → mm/año"
        if any(k in u for k in ("mm/month", "mmmonth-1", "mm/mon")) or u in ("mm", "millimeters"):
            return lambda a, y, m: a / _days_in_month(y, m), "mm/mes → mm/año"
        if u in ("m", "meters", "metre"):
            return lambda a, y, m: a * 1000.0, "m/día → mm/año"
        if not any(k in u for k in ("mm/day", "mmday-1", "mm/d", "mmd-1")):
            warnings.warn(f"Unidades de precipitación desconocidas '{units}', asumo mm/día")
        return lambda a, y, m: a, "mm/día → mm/año"
    if layer == "temp":
        if u in ("k", "kelvin", "degk") or (u == "" and sample_mean > 150):
            return lambda a, y, m: a - 273.15, "K → °C"
        if sample_mean > 150:
            warnings.warn(f"Temperatura con unidades '{units}' pero media {sample_mean:.1f}: asumo Kelvin")
            return lambda a, y, m: a - 273.15, "K → °C"
        return lambda a, y, m: a, "°C"
    if layer == "stars":
        # CLDTOT es fracción 0–1 de nubes → % de cielo despejado
        if sample_mean <= 1.5:
            return lambda a, y, m: (1.0 - a) * 100.0, "fracción de nubes → % cielo despejado"
        return lambda a, y, m: 100.0 - a, "% nubes → % cielo despejado"
    # water
    if u in ("m", "meters", "metre", "meter"):
        return lambda a, y, m: a * 100.0, "m → cm"
    if u in ("mm", "millimeters", "kgm-2"):
        return lambda a, y, m: a / 10.0, "mm → cm"
    return lambda a, y, m: a, "cm"


def _days_in_month(y: int, m: int) -> float:
    if m == 2:
        return 29.0 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 28.0
    return 30.0 if m in (4, 6, 9, 11) else 31.0


# ---------------------------------------------------------------------------
# Regrillado por promedio ponderado (cos lat) a la grilla destino
# ---------------------------------------------------------------------------
class Binner:
    def __init__(self, src_lat: np.ndarray, src_lon: np.ndarray, grid: Grid):
        lon = ((np.asarray(src_lon, dtype=float) + 180.0) % 360.0) - 180.0
        lat = np.asarray(src_lat, dtype=float)
        self.grid = grid
        LAT, LON = np.meshgrid(lat, lon, indexing="ij")
        ilat = np.clip(np.floor((LAT + 90.0) / grid.res).astype(int), 0, grid.nlat - 1)
        ilon = np.clip(np.floor((LON + 180.0) / grid.res).astype(int), 0, grid.nlon - 1)
        self.idx = (ilat * grid.nlon + ilon).ravel()
        self.w = np.cos(np.deg2rad(LAT)).ravel().clip(1e-6)
        n = grid.nlat * grid.nlon
        counts = np.bincount(self.idx, minlength=n)
        # Celdas destino sin ningún punto fuente (fuente más gruesa que destino): vecino más cercano
        self.fill_cells = np.where(counts == 0)[0]
        self.fill_src = None
        if self.fill_cells.size:
            tlat = grid.lat[self.fill_cells // grid.nlon]
            tlon = grid.lon[self.fill_cells % grid.nlon]
            inside = (tlat >= lat.min() - abs(np.diff(lat)).max(initial=grid.res)) & (
                tlat <= lat.max() + abs(np.diff(lat)).max(initial=grid.res)
            )
            order_lon = np.argsort(lon)
            slon = lon[order_lon]
            iy = np.abs(lat[None, :] - tlat[:, None]).argmin(axis=1)
            pos = np.clip(np.searchsorted(slon, tlon), 0, len(slon) - 1)
            pos2 = np.clip(pos - 1, 0, len(slon) - 1)
            pick = np.where(np.abs(slon[pos] - tlon) < np.abs(slon[pos2] - tlon), pos, pos2)
            ix = order_lon[pick]
            dlon = np.abs(slon[pick] - tlon)
            span = (np.abs(np.diff(slon)).max(initial=grid.res)) * 1.5
            ok = inside & (dlon <= max(span, grid.res))
            self.fill_cells = self.fill_cells[ok]
            self.fill_src = (iy[ok] * len(lon) + ix[ok])

    def __call__(self, field2d: np.ndarray) -> np.ndarray:
        g = self.grid
        n = g.nlat * g.nlon
        flat = np.asarray(field2d, dtype=float).ravel()
        valid = np.isfinite(flat)
        wsum = np.bincount(self.idx[valid], weights=self.w[valid], minlength=n)
        vsum = np.bincount(self.idx[valid], weights=flat[valid] * self.w[valid], minlength=n)
        with np.errstate(invalid="ignore", divide="ignore"):
            out = np.where(wsum > 0, vsum / wsum, np.nan)
        if self.fill_src is not None and self.fill_cells.size:
            out[self.fill_cells] = flat[self.fill_src]
        return out


# ---------------------------------------------------------------------------
# Carga de una capa: une los tramos de todos los archivos
# ---------------------------------------------------------------------------
def load_layer(layer: str, entries: list, grid: Grid, year0: int, year1: int):
    """Devuelve (annual[nyears, ncell], info). Une tramos y elimina duplicados."""
    steps: dict[tuple[int, int], np.ndarray] = {}
    units_seen = set()
    conv_desc = None
    for e in sorted(entries, key=lambda x: x["path"].name):
        ds = open_any(e["path"], e.get("group"))
        da = ds[e["varname"]]
        latn, lonn = e["lat"], e["lon"]
        timen = next((t for t in TIME_NAMES if t in da.dims), None)
        # Reducir dims extra (nivel, banda, etc.) tomando el primer índice
        for d in list(da.dims):
            if d not in (latn, lonn, timen):
                da = da.isel({d: 0})
        da = da.transpose(*([timen] if timen else []), latn, lonn)
        src_lat = ds[latn].values
        src_lon = ds[lonn].values
        binner = Binner(src_lat, src_lon, grid)
        units = da.attrs.get("units", "")
        units_seen.add(units)
        first = da.isel({timen: 0}).values if timen else da.values
        conv, conv_desc = unit_converter(layer, units, float(np.nanmean(first)) if np.isfinite(first).any() else 0.0)

        if timen:
            years = ds[timen].dt.year.values
            months = ds[timen].dt.month.values
            stamps = list(zip(years.tolist(), months.tolist()))
        else:
            ym = _date_from_attrs_or_name(ds, e["path"])
            if not ym:
                log(f"  ✗ {e['path'].name}: sin dimensión de tiempo ni fecha en atributos/nombre, se omite")
                ds.close()
                continue
            stamps = [ym]

        kept = 0
        for i, (y, m) in enumerate(stamps):
            if y < year0 or y > year1:
                continue
            arr = da.isel({timen: i}).values if timen else da.values
            arr = conv(np.asarray(arr, dtype=float), y, m)
            if (y, m) in steps:
                # Tramos solapados: se queda el último archivo (orden alfabético) pero rellenando huecos
                prev = steps[(y, m)]
                new = binner(arr)
                steps[(y, m)] = np.where(np.isfinite(new), new, prev).astype(np.float32)
            else:
                steps[(y, m)] = binner(arr).astype(np.float32)
            kept += 1
        log(f"  · {e['path'].name}: {kept} pasos de tiempo dentro de {year0}-{year1} ({conv_desc})")
        ds.close()

    if not steps:
        return None, None

    years = list(range(year0, year1 + 1))
    per_year = defaultdict(list)
    for (y, m), arr in sorted(steps.items()):
        per_year[y].append(arr)
    typical = int(np.median([len(v) for v in per_year.values()]))
    min_steps = max(1, math.ceil(typical * 0.75))
    ncell = grid.nlat * grid.nlon
    annual = np.full((len(years), ncell), np.nan)
    partial_years = []
    if typical >= 12:
        # Datos mensuales: media anual = climatología anual + media de ANOMALÍAS mensuales disponibles.
        # Así un año incompleto (ej. 2025 con datos hasta septiembre) no queda sesgado por la estacionalidad.
        clim_m = np.full((12, ncell), np.nan, dtype=np.float32)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            for m in range(1, 13):
                arrs = [a for (yy, mm), a in steps.items() if mm == m]
                if arrs:
                    clim_m[m - 1] = np.nanmean(np.vstack(arrs), axis=0)
            clim_year = np.nanmean(clim_m, axis=0)
        for k, y in enumerate(years):
            months = [(m, steps[(y, m)]) for m in range(1, 13) if (y, m) in steps]
            if not months:
                continue
            if len(months) < 12:
                partial_years.append(f"{y} ({len(months)}/12 meses)")
            anoms = np.vstack([a - clim_m[m - 1] for m, a in months])
            count = np.isfinite(anoms).sum(axis=0)
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                mean_anom = np.nanmean(anoms, axis=0)
            annual[k] = np.where(count >= min_steps, clim_year + mean_anom, np.nan)
        if partial_years:
            log(f"  ⓘ años incompletos corregidos por estacionalidad: {', '.join(partial_years)}")
    else:
        for k, y in enumerate(years):
            stack = per_year.get(y)
            if not stack:
                continue
            stack = np.vstack(stack)
            count = np.isfinite(stack).sum(axis=0)
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                mean = np.nanmean(stack, axis=0)
            annual[k] = np.where(count >= min_steps, mean, np.nan)
    if LAYERS[layer]["agg"] == "mean_rate":
        annual *= 365.25  # mm/día -> mm/año

    covered = [y for y in years if y in per_year]
    missing = [y for y in years if y not in per_year]
    info = {
        "steps": len(steps),
        "stepsPerYear": typical,
        "yearsCovered": [min(covered), max(covered)] if covered else None,
        "yearsMissing": missing,
        "unitsIn": sorted(u for u in units_seen if u),
        "conversion": conv_desc,
        "partialYears": partial_years,
        "annualMethod": "climatología mensual + anomalías mensuales" if typical >= 12 else "media de pasos",
    }
    if missing:
        log(f"  ⚠ Años sin datos en {layer}: {missing}")
    return annual, info


# ---------------------------------------------------------------------------
# Mann-Kendall por celda
# ---------------------------------------------------------------------------
def mann_kendall_grid(annual: np.ndarray, years: list[int], test: str, alpha: float, min_years: int):
    import pymannkendall as mk

    fn = {"original": mk.original_test, "hamed_rao": mk.hamed_rao_modification_test, "yue_wang": mk.yue_wang_modification_test}[test]
    nyears, ncell = annual.shape
    yrs = np.asarray(years, dtype=float)
    out = {k: [None] * ncell for k in ("slope", "intercept", "p", "tau", "z", "trend", "n")}
    done = 0
    for c in range(ncell):
        s = annual[:, c]
        ok = np.isfinite(s)
        n = int(ok.sum())
        if n < min_years:
            continue
        v = s[ok]
        x = yrs[ok]
        if np.nanstd(v) == 0:
            res_p, res_tau, res_z, h = 1.0, 0.0, 0.0, False
        else:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                r = fn(v, alpha=alpha)
            res_p, res_tau, res_z, h = float(r.p), float(r.Tau), float(r.z), bool(r.h)
        # Pendiente de Sen con los años reales (correcta aunque falten años)
        i, j = np.triu_indices(n, k=1)
        slope = float(np.median((v[j] - v[i]) / (x[j] - x[i])))
        intercept = float(np.median(v - slope * (x - years[0])))  # valor en el año inicial
        out["slope"][c] = slope
        out["intercept"][c] = intercept
        out["p"][c] = res_p
        out["tau"][c] = res_tau
        out["z"][c] = res_z
        out["trend"][c] = (1 if res_tau > 0 else -1) if h else 0
        out["n"][c] = n
        done += 1
        if done % 2000 == 0:
            log(f"    MK: {done} celdas…")
    return out


def apply_fdr(mkres: dict, alpha: float) -> int:
    """Corrección de Benjamini-Hochberg sobre todas las celdas evaluadas (control de falsos positivos
    por comparaciones múltiples). Agrega q-values y recalcula 'trend' con q < alpha."""
    idx = [c for c, p in enumerate(mkres["p"]) if p is not None and np.isfinite(p)]
    q_all = [None] * len(mkres["p"])
    if idx:
        p = np.array([mkres["p"][c] for c in idx])
        m = len(p)
        order = np.argsort(p)
        ranked = p[order] * m / np.arange(1, m + 1)
        q_sorted = np.minimum.accumulate(ranked[::-1])[::-1].clip(0, 1)
        q = np.empty(m)
        q[order] = q_sorted
        for c, qv in zip(idx, q):
            q_all[c] = float(qv)
    before = sum(1 for t in mkres["trend"] if t)
    mkres["q"] = q_all
    for c, qv in enumerate(q_all):
        if qv is None:
            continue
        tau = mkres["tau"][c] or 0.0
        mkres["trend"][c] = (1 if tau > 0 else -1) if (qv < alpha and tau != 0) else 0
    after = sum(1 for t in mkres["trend"] if t)
    log(f"    FDR (Benjamini-Hochberg): {before} → {after} celdas significativas")
    return after


# ---------------------------------------------------------------------------
# Exportación JSON compacta
# ---------------------------------------------------------------------------
def _r(x, nd):
    return None if x is None or not np.isfinite(x) else round(float(x), nd)


def _sig(x, n):
    """Redondeo a n cifras significativas (JSON más liviano sin perder precisión relativa)."""
    if x is None or not np.isfinite(x):
        return None
    return float(f"{float(x):.{n}g}")


def export_layer(layer: str, annual: np.ndarray, years: list[int], grid: Grid, mkres: dict, source: str, extra: dict, test: str, alpha: float):
    cfg = LAYERS[layer]
    scale = cfg["scale"]
    nyears, ncell = annual.shape
    # values: celda-mayor -> values[cell * nyears + t]
    vals = annual.T.ravel()
    values = [None if not np.isfinite(v) else int(round(v * scale)) for v in vals]
    finite = annual[np.isfinite(annual)]
    slopes = np.array([s for s in mkres["slope"] if s is not None], dtype=float)
    clim = np.nanmean(annual, axis=0)
    anom = annual - clim
    anom_f = np.abs(anom[np.isfinite(anom)])
    sig = [t for t in mkres["trend"] if t is not None]
    doc = {
        "schema": SCHEMA_LAYER,
        "id": layer,
        "label": cfg["label"],
        "product": extra.get("product", cfg["product"]),
        "units": cfg["units"],
        "source": source,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "years": years,
        "grid": grid.to_json(),
        "scale": scale,
        "values": values,
        "mk": {
            "test": test,
            "alpha": alpha,
            "slope": [_sig(v, 4) for v in mkres["slope"]],
            "intercept": [_sig(v, 5) for v in mkres["intercept"]],
            "p": [_r(v, 4) for v in mkres["p"]],
            "tau": [_r(v, 3) for v in mkres["tau"]],
            "z": [_r(v, 2) for v in mkres["z"]],
            "q": [_r(v, 4) for v in mkres["q"]] if mkres.get("q") else None,
            "fdr": bool(mkres.get("q")),
            "trend": mkres["trend"],
        },
        "stats": {
            "min": _r(finite.min(), 3) if finite.size else None,
            "max": _r(finite.max(), 3) if finite.size else None,
            "slopeAbsP95": _r(np.percentile(np.abs(slopes), 95), 5) if slopes.size else None,
            "anomAbsP95": _r(np.percentile(anom_f, 95), 3) if anom_f.size else None,
            "cellsWithData": int(sum(1 for t in mkres["n"] if t)),
            "cellsUp": int(sum(1 for t in sig if t == 1)),
            "cellsDown": int(sum(1 for t in sig if t == -1)),
        },
        "ingest": extra.get("ingest"),
    }
    path = OUT_DIR / f"layer_{layer}.json"
    path.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False))
    log(f"  → {path}  ({path.stat().st_size / 1024:.0f} KB)  ↑{doc['stats']['cellsUp']} ↓{doc['stats']['cellsDown']} celdas significativas")
    return {
        "id": layer,
        "label": cfg["label"],
        "file": path.name,
        "units": cfg["units"],
        "product": doc["product"],
        "source": source,
        "generatedAt": doc["generatedAt"],
    }


def write_meta(layer_entries: list[dict], years: list[int], grid: Grid, test: str, alpha: float):
    meta_path = OUT_DIR / "meta.json"
    existing = {}
    if meta_path.exists():
        try:
            existing = {l["id"]: l for l in json.loads(meta_path.read_text()).get("layers", [])}
        except Exception:  # noqa: BLE001
            existing = {}
    for e in layer_entries:
        existing[e["id"]] = e
    layers = [existing[k] for k in LAYER_ORDER if k in existing]
    meta = {
        "schema": SCHEMA_META,
        "app": "EarthTrends",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "years": [years[0], years[-1]],
        "grid": grid.to_json(),
        "mk": {"test": test, "alpha": alpha},
        "layers": layers,
        "sources": [
            {"name": "NASA Earthdata / GES DISC · GPM IMERG Final Monthly (GPM_3IMERGM v07)",
             "url": "https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGM_07/summary"},
            {"name": "NASA Earthdata / GES DISC · MERRA-2 M2TMNXSLV v5.12.4 (T2M)",
             "url": "https://disc.gsfc.nasa.gov/datasets/M2TMNXSLV_5.12.4/summary"},
            {"name": "NASA Earthdata / GES DISC · MERRA-2 M2TMNXRAD v5.12.4 (CLDTOT, cloud fraction)",
             "url": "https://disc.gsfc.nasa.gov/datasets/M2TMNXRAD_5.12.4/summary"},
            {"name": "NASA Earth Observatory · Earth at Night / Black Marble (light pollution)",
             "url": "https://earthobservatory.nasa.gov/features/NightLights"},
            {"name": "NASA Giovanni (exploration of GPM IMERG and MERRA-2)", "url": "https://giovanni.gsfc.nasa.gov"},
            {"name": "NASA PO.DAAC · GRACE/GRACE-FO JPL Mascon RL06.3 v04 CRI (TWS)",
             "url": "https://podaac.jpl.nasa.gov/dataset/TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4"},
        ],
    }
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    log(f"→ {meta_path}")


# ---------------------------------------------------------------------------
# Mock data (mismo esquema, claramente marcado como source = "mock")
# ---------------------------------------------------------------------------
def _gc_dist_deg(lat1, lon1, lat2, lon2):
    p1, p2 = np.deg2rad(lat1), np.deg2rad(lat2)
    dl = np.deg2rad(lon2 - lon1)
    c = np.sin(p1) * np.sin(p2) + np.cos(p1) * np.cos(p2) * np.cos(dl)
    return np.rad2deg(np.arccos(np.clip(c, -1, 1)))


def _smooth_field(rng, LAT, LON, n_bumps=45, width=(12, 35), center=False):
    f = np.zeros_like(LAT)
    for _ in range(n_bumps):
        clat = np.rad2deg(np.arcsin(rng.uniform(-1, 1)))
        clon = rng.uniform(-180, 180)
        w = rng.uniform(*width)
        f += rng.normal() * np.exp(-((_gc_dist_deg(LAT, LON, clat, clon) / w) ** 2))
    if center:
        f -= np.average(f, weights=np.cos(np.deg2rad(LAT)))
    return f / (np.abs(f).max() + 1e-9)


def build_mock(grid: Grid, years: list[int], seed: int):
    rng = np.random.default_rng(seed)
    LAT, LON = np.meshgrid(grid.lat, grid.lon, indexing="ij")
    ny = len(years)
    t = np.arange(ny) - (ny - 1) / 2
    enso = np.sin(np.arange(ny) * 2 * np.pi / 4.3 + 0.7) + 0.5 * rng.normal(size=ny)
    def noise():
        # Variabilidad interanual espacialmente coherente (como el clima real) + un poco de ruido local
        f = np.stack([_smooth_field(rng, LAT, LON, 40, (6, 16), center=True) for _ in range(ny)])
        f /= f.std() + 1e-9
        return 0.85 * f + 0.35 * rng.normal(size=f.shape)

    cases = json.loads(((OUT_DIR / "cases.json") if (OUT_DIR / "cases.json").exists() else (ROOT / "public" / "data" / "cases.json")).read_text())["cases"]

    def plant(trend, layer, strength):
        for c in cases:
            if c["layer"] != layer:
                continue
            for side in ("a", "b"):
                p = c[side]
                sign = {"up": 1, "down": -1}.get(p.get("expected"), 0)
                bump = np.exp(-((_gc_dist_deg(LAT, LON, p["lat"], p["lon"]) / 7.0) ** 2))
                trend = trend * (1 - bump) + sign * strength * bump
        return trend

    out = {}
    # Precipitación (mm/año)
    clim = 2600 * np.exp(-((LAT - 5) / 12) ** 2) + 900 * np.exp(-((np.abs(LAT) - 50) / 15) ** 2) + 250
    clim *= 1 + 0.45 * _smooth_field(rng, LAT, LON)
    clim = clim.clip(60)
    tr = plant(0.9 * _smooth_field(rng, LAT, LON, center=True), "precip", 1.6)  # fracción relativa
    slope = tr * 0.012 * clim  # hasta ~1.2 %/año
    tele = _smooth_field(rng, LAT, LON, 20, (20, 50))
    series = clim[None] + slope[None] * t[:, None, None] + 0.10 * clim[None] * (
        0.55 * enso[:, None, None] * tele[None] + noise() * 0.7
    )
    out["precip"] = series.clip(10)

    # Temperatura (°C)
    clim = 29 * np.cos(np.deg2rad(LAT)) ** 1.4 - 14 + 4 * _smooth_field(rng, LAT, LON) - 18 * (np.abs(LAT) > 66)
    tr = plant(0.55 + 0.75 * _smooth_field(rng, LAT, LON), "temp", 1.5)
    slope = tr * 0.035 * (1 + 0.8 * (np.abs(LAT) / 90) ** 2)  # amplificación polar
    series = clim[None] + slope[None] * t[:, None, None] + 0.18 * enso[:, None, None] * tele[None] + noise() * 0.22
    out["temp"] = series

    # Agua (anomalía de altura de agua, cm)
    tr = plant(_smooth_field(rng, LAT, LON, center=True), "water", 1.7)
    slope = tr * 1.4
    series = slope[None] * t[:, None, None] + 3.0 * enso[:, None, None] * tele[None] + noise() * 3.2
    out["water"] = series - series.mean(axis=0, keepdims=True)

    return {k: v.reshape(ny, -1) for k, v in out.items()}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    global OUT_DIR
    ap = argparse.ArgumentParser(description="EarthTrends · NetCDF → Mann-Kendall → JSON")
    ap.add_argument("--raw", default=str(RAW_DIR), help="carpeta con .nc (default: raw-data/)")
    ap.add_argument("--start", type=int, default=2005)
    ap.add_argument("--end", type=int, default=2025)
    ap.add_argument("--res", type=float, default=1.0, help="resolución de la grilla de salida en grados")
    ap.add_argument("--viz-res", type=float, default=0.25,
                    help="resolución de las imágenes del globo (0 = no exportar imágenes)")
    ap.add_argument("--alpha", type=float, default=0.05)
    ap.add_argument("--no-fdr", action="store_true", help="no aplicar la corrección FDR de Benjamini-Hochberg")
    ap.add_argument("--min-years", type=int, default=10, help="años válidos mínimos por celda para correr MK")
    ap.add_argument("--test", choices=["original", "hamed_rao", "yue_wang"], default="hamed_rao",
                    help="variante de Mann-Kendall (hamed_rao corrige autocorrelación)")
    ap.add_argument("--var", action="append", default=[], metavar="CAPA=VARIABLE",
                    help="forzar variable de una capa, ej. --var temp=T2M")
    ap.add_argument("--only", choices=LAYER_ORDER, action="append", help="procesar solo esta capa")
    ap.add_argument("--scan", action="store_true", help="solo listar archivos y variables detectadas")
    ap.add_argument("--mock", action="store_true", help="generar datos de prueba con el mismo esquema")
    ap.add_argument("--seed", type=int, default=2026)
    ap.add_argument("--out", default=str(OUT_DIR), help="carpeta de salida (default: public/data/)")
    args = ap.parse_args()

    OUT_DIR = Path(args.out).resolve()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    grid = Grid(args.res)
    years = list(range(args.start, args.end + 1))
    wanted = args.only or LAYER_ORDER
    entries = []

    if args.mock:
        log(f"⚙  MOCK · grilla {grid.res}° ({grid.nlat}×{grid.nlon}) · {years[0]}–{years[-1]}")
        data = build_mock(grid, years, args.seed)
        for layer in wanted:
            log(f"[{layer}] Mann-Kendall ({args.test})…")
            mkres = mann_kendall_grid(data[layer], years, args.test, args.alpha, args.min_years)
            if not args.no_fdr:
                apply_fdr(mkres, args.alpha)
            entries.append(export_layer(layer, data[layer], years, grid, mkres, "mock",
                                        {"product": LAYERS[layer]["product"] + " · MOCK"}, args.test, args.alpha))
        write_meta(entries, years, grid, args.test, args.alpha)
        return 0

    forced = {}
    for spec in args.var:
        k, _, v = spec.partition("=")
        if k not in LAYERS or not v:
            ap.error(f"--var inválido: {spec}")
        forced[k] = v

    raw = Path(args.raw)
    log(f"🔎 Escaneando {raw}")
    found = scan_files(raw, forced)
    if args.scan:
        return 0

    for layer in wanted:
        variants = found.get(layer)
        if not variants:
            log(f"[{layer}] sin archivos — se mantiene el JSON anterior (si existe)")
            continue
        # Se unen TODOS los archivos de la capa (ej. Giovanni 2005–2011 'GPM_3IMERGM_07_precipitation'
        # + gránulos earthaccess 'precipitation'). Cada archivo convierte sus propias unidades;
        # si un mes aparece dos veces, gana el último archivo en orden alfabético.
        files = []
        for vname, fl in variants.items():
            for f in fl:
                f["varname"] = vname
                files.append(f)
        varname = " + ".join(variants)
        log(f"[{layer}] uniendo {len(files)} archivo(s) de {list(variants)}")
        viz_meta = None
        k = args.res / args.viz_res if args.viz_res else 0
        if args.viz_res and abs(k - round(k)) < 1e-9 and round(k) >= 1:
            # Una sola lectura a la grilla fina: de ahí salen las imágenes HD y, promediando, la grilla de 1°
            fine_grid = Grid(args.viz_res)
            annual_fine, info = load_layer(layer, files, fine_grid, years[0], years[-1])
            if annual_fine is not None and LAYERS[layer].get("land_only"):
                annual_fine[:, ~land_mask(fine_grid)] = np.nan
                info["landOnly"] = True
                log("  ⓘ capa solo continental: océano enmascarado (Natural Earth)")
            if annual_fine is not None:
                viz_meta = viz_export.export_viz(layer, annual_fine, years, fine_grid, OUT_DIR, args.min_years,
                                                LAYERS[layer].get("viz_smooth_deg", 0.0))
                annual = viz_export.coarsen(annual_fine, fine_grid, grid)
                del annual_fine
            else:
                annual = None
        else:
            if args.viz_res:
                log(f"  ⚠ --res {args.res} no es múltiplo de --viz-res {args.viz_res}: sin imágenes HD")
            annual, info = load_layer(layer, files, grid, years[0], years[-1])
            if annual is not None and LAYERS[layer].get("land_only"):
                annual[:, ~land_mask(grid)] = np.nan
                info["landOnly"] = True
        if annual is None:
            log(f"[{layer}] ✗ sin datos dentro de {years[0]}-{years[-1]}")
            continue
        valid_years = int(np.isfinite(annual).any(axis=1).sum())
        if valid_years < args.min_years:
            log(f"[{layer}] ⚠ solo {valid_years} años con datos (< {args.min_years}); MK no será significativo. "
                "SWOT empezó en 2023: para 20 años de agua usá GRACE/GRACE-FO o Hydroweb.")
        log(f"[{layer}] Mann-Kendall ({args.test}) en {grid.nlat * grid.nlon} celdas…")
        mkres = mann_kendall_grid(annual, years, args.test, args.alpha, args.min_years)
        if not args.no_fdr:
            apply_fdr(mkres, args.alpha)
        names = sorted(f["path"].name for f in files)
        info["files"] = names if len(names) <= 6 else names[:3] + [f"… ({len(names) - 6} más) …"] + names[-3:]
        info["fileCount"] = len(names)
        info["variable"] = varname
        product = LAYERS[layer]["product"]
        entry = export_layer(layer, annual, years, grid, mkres, "nasa", {"product": product, "ingest": info}, args.test, args.alpha)
        if viz_meta:
            entry["viz"] = viz_meta
        entries.append(entry)

    if entries:
        write_meta(entries, years, grid, args.test, args.alpha)
    else:
        log("Nada para exportar.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
