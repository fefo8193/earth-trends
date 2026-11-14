#!/usr/bin/env python3
"""
EarthTrends · Descarga de datos NASA por API oficial (earthaccess / CMR + Earthdata Login).

Descarga en paralelo los gránulos mensuales que FALTAN en raw-data/ y los recorta a la
única variable que usa el pipeline (archivos .nc4 comprimidos, mucho más livianos):

  precip  GPM_3IMERGM v07   · variable 'precipitation' (mm/h)  → raw-data/precip/IMERG_V07_YYYYMM.nc4
  temp    M2TMNXSLV 5.12.4  · variable 'T2M' (K)               → raw-data/temp/MERRA2_T2M_YYYYMM.nc4
  water   (opcional) GRACE/GRACE-FO JPL Mascon RL06.3 CRI · 'lwe_thickness' → raw-data/water/

Antes de bajar, revisa qué meses ya hay en raw-data/ (incluido cualquier archivo de Giovanni)
y solo pide los que faltan.

Uso:
    .venv/bin/python scripts/download_nasa.py --login          # guarda tu login en ~/.netrc (una vez)
    .venv/bin/python scripts/download_nasa.py                  # precip + temp 2005–2025, solo faltantes
    .venv/bin/python scripts/download_nasa.py --only temp --workers 12
    .venv/bin/python scripts/download_nasa.py --water          # suma GRACE/GRACE-FO para la capa de agua
    .venv/bin/python scripts/download_nasa.py --dry-run        # solo muestra qué bajaría

Requisito en urs.earthdata.nasa.gov → Applications → Authorized Apps:
    "NASA GESDISC DATA ARCHIVE" aprobada (para IMERG y MERRA-2).
"""
from __future__ import annotations

import argparse
import shutil
import sys
import time

from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import climate_pipeline as cp  # noqa: E402

ROOT = cp.ROOT
RAW = cp.RAW_DIR
CACHE = RAW / "_cache"

DATASETS = {
    "precip": {
        "short_name": "GPM_3IMERGM",
        "version": "07",
        "variable": "precipitation",
        "group": "Grid",
        "prefix": "IMERG_V07",
        "monthly": True,
        "provider": "NASA GES DISC",
    },
    "temp": {
        "short_name": "M2TMNXSLV",
        "version": "5.12.4",
        "variable": "T2M",
        "group": None,
        "prefix": "MERRA2_T2M",
        "monthly": True,
        "provider": "NASA GES DISC",
    },
    "water": {
        "short_name": "TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4",
        "version": None,
        "variable": "lwe_thickness",
        "group": None,
        "prefix": "GRACE_GRFO_MASCON_CRI",
        "monthly": False,  # un único archivo con toda la serie
        "provider": "NASA PO.DAAC",
    },
    "stars": {
        # Nubosidad total MERRA-2 → fracción de cielo despejado (visibilidad de estrellas)
        "short_name": "M2TMNXRAD",
        "version": "5.12.4",
        "variable": "CLDTOT",
        "group": None,
        "prefix": "MERRA2_CLDTOT",
        "monthly": True,
        "provider": "NASA GES DISC",
    },
}


def log(msg: str) -> None:
    print(msg, flush=True)


# ---------------------------------------------------------------------------
# Login Earthdata (la contraseña la tipea el usuario; nunca se imprime ni se guarda en el repo)
# ---------------------------------------------------------------------------
def login(force_interactive: bool):
    import logging

    import earthaccess

    # earthaccess registra el motivo del rechazo de URS en nivel INFO: lo mostramos (nunca incluye la contraseña)
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("  earthaccess: %(message)s"))
    ea_log = logging.getLogger("earthaccess")
    ea_log.setLevel(logging.INFO)
    ea_log.addHandler(handler)

    if not force_interactive:
        try:
            auth = earthaccess.login(strategy="netrc")
            if auth and auth.authenticated:
                log("🔐 Earthdata: sesión iniciada con ~/.netrc")
                return auth
        except Exception:  # noqa: BLE001
            pass
        try:
            auth = earthaccess.login(strategy="environment")
            if auth and auth.authenticated:
                log("🔐 Earthdata: sesión iniciada con EARTHDATA_USERNAME / EARTHDATA_PASSWORD")
                return auth
        except Exception:  # noqa: BLE001
            pass
        if not sys.stdin.isatty():
            sys.exit("✗ No hay credenciales de Earthdata. Corré primero: .venv/bin/python scripts/download_nasa.py --login")
    if force_interactive == "dialog":
        return login_dialog()
    log("🔐 Login NASA Earthdata (usuario: el tuyo, ej. fefom). La contraseña no se muestra al tipear.")
    auth = earthaccess.login(strategy="interactive", persist=True)
    if not auth or not auth.authenticated:
        sys.exit("✗ Login fallido. Revisá usuario/contraseña en https://urs.earthdata.nasa.gov")
    log("✓ Credenciales guardadas en ~/.netrc (solo en tu compu)")
    return auth


def _ask_dialog(prompt: str, default: str = "", hidden: bool = False) -> str:
    """Ventana nativa de macOS (osascript). El texto tipeado no se imprime en ningún lado."""
    import subprocess

    script = (
        f'display dialog "{prompt}" default answer "{default}" '
        f'{"with hidden answer " if hidden else ""}'
        'with title "EarthTrends · NASA Earthdata Login" buttons {"Cancelar", "OK"} default button "OK"'
    )
    r = subprocess.run(["osascript", "-e", script, "-e", "text returned of result"], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("✗ Login cancelado")
    return r.stdout.rstrip("\n")


def login_dialog():
    """Pide usuario/contraseña en ventanas nativas, valida contra URS y guarda ~/.netrc (permisos 600)."""
    import os

    import earthaccess

    user = _ask_dialog("Usuario de NASA Earthdata:", "fefom")
    pwd = _ask_dialog(f"Contraseña de Earthdata para {user}:", hidden=True)
    os.environ["EARTHDATA_USERNAME"] = user
    os.environ["EARTHDATA_PASSWORD"] = pwd
    try:
        auth = earthaccess.login(strategy="environment")
    finally:
        os.environ.pop("EARTHDATA_PASSWORD", None)
    if not auth or not auth.authenticated:
        sys.exit("✗ Login fallido: URS rechazó usuario/contraseña (ver línea 'earthaccess:' arriba)")
    netrc = Path.home() / ".netrc"
    lines = netrc.read_text().splitlines() if netrc.exists() else []
    lines = [l for l in lines if "urs.earthdata.nasa.gov" not in l]
    lines.append(f"machine urs.earthdata.nasa.gov login {user} password {pwd}")
    netrc.write_text("\n".join(lines) + "\n")
    netrc.chmod(0o600)
    del pwd
    log(f"✓ Login OK como {user} · credenciales guardadas en ~/.netrc (solo en tu compu)")
    return auth


# ---------------------------------------------------------------------------
# Qué meses ya tenemos
# ---------------------------------------------------------------------------
def existing_months(layer: str) -> set[tuple[int, int]]:
    have: set[tuple[int, int]] = set()
    found = cp.scan_files(RAW, {}, quiet=True)
    for _var, entries in found.get(layer, {}).items():
        for e in entries:
            try:
                ds = cp.open_any(e["path"])
            except RuntimeError:
                continue
            tname = next((t for t in cp.TIME_NAMES if t in ds.dims), None)
            if tname:
                for y, m in zip(ds[tname].dt.year.values.tolist(), ds[tname].dt.month.values.tolist()):
                    have.add((int(y), int(m)))
            else:
                ym = cp._date_from_attrs_or_name(ds, e["path"])
                if ym:
                    have.add(ym)
            ds.close()
    return have


def granule_month(g) -> tuple[int, int] | None:
    try:
        begin = g["umm"]["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"]
        return int(begin[:4]), int(begin[5:7])
    except Exception:  # noqa: BLE001
        return None


# ---------------------------------------------------------------------------
# Recorte a una sola variable (archivo chico, compresión zlib)
# ---------------------------------------------------------------------------
def subset_to_variable(src: Path, layer: str, ym: tuple[int, int] | None) -> Path:
    import xarray as xr

    cfg = DATASETS[layer]
    kw = {"group": cfg["group"]} if cfg["group"] else {}
    last = None
    ds = None
    for engine in ("h5netcdf", "netcdf4"):
        try:
            ds = xr.open_dataset(src, engine=engine, use_cftime=True, **kw)
            break
        except Exception as exc:  # noqa: BLE001
            last = exc
    if ds is None:
        raise RuntimeError(f"No se pudo abrir {src.name}: {last}")
    var = cfg["variable"]
    if var not in ds:
        raise RuntimeError(f"{src.name} no tiene la variable '{var}' (tiene: {list(ds.data_vars)[:8]})")
    out = ds[[var]]
    # Sin coordenadas auxiliares pesadas
    out = out.drop_vars([v for v in out.coords if v not in out[var].dims], errors="ignore")
    out[var] = out[var].astype("float32")
    out.attrs = {
        "title": f"EarthTrends subset of {cfg['short_name']} ({var})",
        "source_granule": src.name,
        "source_collection": f"{cfg['short_name']} v{cfg['version'] or ''}".strip(),
        "provider": cfg["provider"],
        "history": "Recortado a una variable por scripts/download_nasa.py (sin modificar valores)",
    }
    layer_dir = RAW / layer
    layer_dir.mkdir(parents=True, exist_ok=True)
    tag = f"{ym[0]}{ym[1]:02d}" if ym else src.stem
    dst = layer_dir / f"{cfg['prefix']}_{tag}.nc4"
    tmp = dst.with_suffix(".tmp")
    enc = {var: {"zlib": True, "complevel": 4, "dtype": "float32"}}
    out.load().to_netcdf(tmp, engine="netcdf4", encoding=enc)
    ds.close()
    tmp.rename(dst)
    return dst


# ---------------------------------------------------------------------------
# Descarga por capa
# ---------------------------------------------------------------------------
def fetch_layer(layer: str, start: int, end: int, workers: int, batch: int, keep_raw: bool, dry: bool) -> int:
    import earthaccess

    cfg = DATASETS[layer]
    log(f"\n[{layer}] {cfg['short_name']} {('v' + cfg['version']) if cfg['version'] else ''} · {cfg['provider']}")
    search = {"short_name": cfg["short_name"], "temporal": (f"{start}-01-01", f"{end}-12-31T23:59:59")}
    if cfg["version"]:
        search["version"] = cfg["version"]
    granules = earthaccess.search_data(**search)
    log(f"  CMR: {len(granules)} gránulos en {start}–{end}")
    if not granules:
        log("  ✗ Sin resultados. Revisá short_name/version o tu conexión.")
        return 0

    if cfg["monthly"]:
        have = existing_months(layer)
        todo = []
        for g in granules:
            ym = granule_month(g)
            if ym and start <= ym[0] <= end and ym not in have:
                todo.append((ym, g))
        todo.sort(key=lambda t: t[0])
        log(f"  Ya hay {len(have)} meses en raw-data · faltan {len(todo)}")
    else:
        existing = list((RAW / layer).glob(f"{cfg['prefix']}_*.nc4")) if (RAW / layer).exists() else []
        if existing:
            log(f"  Ya existe {existing[0].name}, nada que bajar")
            return 0
        todo = [(None, granules[-1])]  # el más reciente contiene toda la serie

    if not todo:
        return 0
    size = sum(float(g.size() or 0) for _, g in todo)
    log(f"  A descargar: {len(todo)} archivo(s), ~{size / 1024:.1f} GB brutos (se recortan a la variable al bajar)")
    if dry:
        for ym, _ in todo[:6]:
            log(f"    · {ym}")
        return 0

    cache = CACHE / layer
    cache.mkdir(parents=True, exist_ok=True)
    done = 0
    t0 = time.time()
    for b in range(0, len(todo), batch):
        chunk = todo[b : b + batch]
        files = earthaccess.download([g for _, g in chunk], local_path=str(cache), threads=workers)
        files = [Path(f) for f in files if f]
        by_name = {f.name: f for f in files}
        # La descarga es paralela; el recorte va en serie porque netCDF/HDF5 no es thread-safe (≈0.5 s por archivo)
        for ym, g in chunk:
            names = [Path(u).name for u in g.data_links()]
            src = next((by_name[n] for n in names if n in by_name), None)
            if src is None:
                log(f"  ✗ {ym}: no se descargó")
                continue
            try:
                dst = subset_to_variable(src, layer, ym)
                done += 1
            except Exception as exc:  # noqa: BLE001
                log(f"  ✗ {exc}")
        if not keep_raw:
            for f in files:
                f.unlink(missing_ok=True)
        rate = done / max(1e-6, time.time() - t0) * 60
        log(f"  ✓ {done}/{len(todo)} listos ({rate:.0f} archivos/min) · último: {dst.name if done else '—'}")
    if not keep_raw:
        shutil.rmtree(cache, ignore_errors=True)
    return done


def main() -> int:
    ap = argparse.ArgumentParser(description="EarthTrends · descarga NASA (earthaccess)")
    ap.add_argument("--start", type=int, default=2005)
    ap.add_argument("--end", type=int, default=2025)
    ap.add_argument("--only", choices=["precip", "temp", "water", "stars"], action="append")
    ap.add_argument("--water", action="store_true", help="incluir GRACE/GRACE-FO para la capa de agua")
    ap.add_argument("--workers", type=int, default=8, help="descargas en paralelo")
    ap.add_argument("--batch", type=int, default=24, help="gránulos por tanda (limita el disco temporal)")
    ap.add_argument("--keep-raw", action="store_true", help="no borrar los gránulos originales")
    ap.add_argument("--login", action="store_true", help="pedir usuario/contraseña y guardarlos en ~/.netrc")
    ap.add_argument("--login-dialog", action="store_true", help="pedir el login en una ventana de macOS")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    login(force_interactive="dialog" if args.login_dialog else args.login)
    layers = args.only or (["precip", "temp"] + (["water"] if args.water else []))
    total = 0
    for layer in layers:
        total += fetch_layer(layer, args.start, args.end, args.workers, args.batch, args.keep_raw, args.dry_run)
    log(f"\n✓ Descarga terminada: {total} archivo(s) nuevos en raw-data/")
    if total and not args.dry_run:
        log("  Siguiente paso: .venv/bin/python scripts/climate_pipeline.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
