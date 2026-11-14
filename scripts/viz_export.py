"""
EarthTrends · Imágenes de alta resolución para el globo (solo visualización).

El cálculo científico (Mann-Kendall, paneles) usa la grilla de 1° del JSON.
Para pintar el planeta exportamos, desde la grilla fina (0.25° por defecto):

  public/data/viz/<capa>/<año>.png   anomalía del año vs. media 2005-2025
  public/data/viz/<capa>/trend.png   pendiente de Sen por píxel

Formato: PNG escala de grises + alpha (modo LA), norte arriba, longitud -180→180.
  gris = 128 + 127·n   con n = valor / escala ∈ [-1, 1]   (alpha 0 = sin dato)
La web colorea cada píxel con la paleta climática de la capa.
"""
from __future__ import annotations

import shutil
import warnings
from pathlib import Path

import numpy as np


def coarsen(fine: np.ndarray, fine_grid, coarse_grid) -> np.ndarray:
    """Promedio ponderado por cos(lat) de la grilla fina a la gruesa (factor entero)."""
    k = int(round(coarse_grid.res / fine_grid.res))
    ny = fine.shape[0]
    a = fine.reshape(ny, coarse_grid.nlat, k, coarse_grid.nlon, k)
    w = np.cos(np.deg2rad(fine_grid.lat)).reshape(coarse_grid.nlat, k)[None, :, :, None, None]
    valid = np.isfinite(a)
    wsum = (w * valid).sum(axis=(2, 4))
    vsum = np.where(valid, a, 0.0) * w
    vsum = vsum.sum(axis=(2, 4))
    with np.errstate(invalid="ignore", divide="ignore"):
        out = np.where(wsum > 0, vsum / wsum, np.nan)
    return out.reshape(ny, -1)


def sen_slope_fast(annual: np.ndarray, years: list[int], min_years: int, chunk: int = 40000) -> np.ndarray:
    """Pendiente de Sen por celda (mediana de pendientes por pares), en bloques para no agotar memoria."""
    ny, ncell = annual.shape
    x = np.asarray(years, dtype=float)
    i, j = np.triu_indices(ny, k=1)
    dx = (x[j] - x[i])[:, None]
    out = np.full(ncell, np.nan)
    for s in range(0, ncell, chunk):
        blk = annual[:, s : s + chunk]
        enough = np.isfinite(blk).sum(axis=0) >= min_years
        if not enough.any():
            continue
        pairs = (blk[j] - blk[i]) / dx
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            med = np.nanmedian(pairs, axis=0)
        out[s : s + chunk] = np.where(enough, med, np.nan)
    return out


def _smooth(field: np.ndarray, grid, sigma_deg: float) -> np.ndarray:
    """Suavizado gaussiano normalizado (ignora NaN y conserva la máscara original)."""
    from scipy.ndimage import gaussian_filter

    img = field.reshape(grid.nlat, grid.nlon)
    ok = np.isfinite(img)
    s = sigma_deg / grid.res
    num = gaussian_filter(np.where(ok, img, 0.0), s, mode=("nearest", "wrap"))
    den = gaussian_filter(ok.astype(float), s, mode=("nearest", "wrap"))
    with np.errstate(invalid="ignore", divide="ignore"):
        out = np.where(ok & (den > 1e-6), num / den, np.nan)
    return out.reshape(-1)


def _robust_scale(arr: np.ndarray, grid, q: float = 95) -> float:
    """Percentil de |valor| fuera de los casquetes polares (que si no dominan la escala)."""
    lat = np.repeat(grid.lat, grid.nlon)
    v = np.abs(arr[..., np.abs(lat) < 60])
    v = v[np.isfinite(v)]
    return float(np.percentile(v, q)) if v.size else 1.0


def _to_png(values: np.ndarray, grid, scale: float, path: Path) -> None:
    from PIL import Image

    img = values.reshape(grid.nlat, grid.nlon)[::-1]  # norte arriba
    ok = np.isfinite(img)
    n = np.clip(np.where(ok, img, 0.0) / scale, -1, 1)
    gray = np.clip(np.rint(128 + 127 * n), 1, 255).astype(np.uint8)
    alpha = np.where(ok, 255, 0).astype(np.uint8)
    Image.fromarray(np.dstack([gray, alpha]), mode="LA").save(path, optimize=True)


def export_viz(layer: str, annual_fine: np.ndarray, years: list[int], fine_grid, out_dir: Path, min_years: int,
               smooth_deg: float = 0.0) -> dict:
    vdir = out_dir / "viz" / layer
    if vdir.exists():
        shutil.rmtree(vdir)
    vdir.mkdir(parents=True)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        clim = np.nanmean(annual_fine, axis=0)
    anom = annual_fine - clim[None]
    if smooth_deg:
        # Fuentes gruesas (GRACE ~3°): suavizamos solo la imagen para que no se vean bloques
        anom = np.stack([_smooth(a, fine_grid, smooth_deg) for a in anom])
    anom_scale = _robust_scale(anom, fine_grid)
    files = {}
    for k, y in enumerate(years):
        if not np.isfinite(anom[k]).any():
            continue
        _to_png(anom[k], fine_grid, anom_scale, vdir / f"{y}.png")
        files[str(y)] = f"viz/{layer}/{y}.png"
    slope = sen_slope_fast(annual_fine, years, min_years)
    if smooth_deg:
        slope = _smooth(slope, fine_grid, smooth_deg)
    trend_scale = _robust_scale(slope, fine_grid)
    _to_png(slope, fine_grid, trend_scale, vdir / "trend.png")
    size_kb = sum(p.stat().st_size for p in vdir.glob("*.png")) / 1024
    print(f"  → viz/{layer}: {len(files)} años + trend.png a {fine_grid.res}° ({fine_grid.nlon}×{fine_grid.nlat} px, {size_kb / 1024:.1f} MB)", flush=True)
    return {
        "res": fine_grid.res,
        "width": fine_grid.nlon,
        "height": fine_grid.nlat,
        "anomScale": round(anom_scale, 4),
        "trendScale": round(trend_scale, 5),
        "years": files,
        "trend": f"viz/{layer}/trend.png",
        "encoding": "PNG LA · gray = 128 + 127·(valor/escala) · alpha 0 = sin dato · norte arriba",
    }
