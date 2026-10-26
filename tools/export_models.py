"""Exporta la IA entrenada a JSON para el navegador.

- Modelo de entradas (HistGradientBoosting, 4 clases): árboles en arrays compactos (base64).
- Cono de predicción: tablas de cuantiles por horizonte y franja de 4 h.
- Historial por escenario de cada estrategia (régimen x volatilidad).
- Fixture de validación: velas + variables calculadas en Python para comprobar el port a TypeScript.

Uso: python3 export_models.py <apphome con data/models> <salida public/ai>
"""
import base64
import json
import os
import sys
import warnings

warnings.filterwarnings("ignore")
import numpy as np
import pandas as pd

SCR = "/tmp/claude-0/-home-claude/baf90c1b-c7ed-5b05-98e3-a355899d42d0/scratchpad"
home, out_dir = sys.argv[1], sys.argv[2]
os.environ["XAUAI_HOME"] = home
sys.path.insert(0, "/home/claude/app/xauai/backend")
import joblib
from xauai.data import BarStore
from xauai.timeutil import Clock
from xauai import features as F
from xauai.signals import ScenarioStats

os.makedirs(out_dir, exist_ok=True)
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()

# ------------------------------------------------------------- modelo de entradas
d = joblib.load(os.path.join(home, "data/models/entry.joblib"))
m = d["model"]
feat_names = list(m.feature_names_in_)
trees_meta = []
F_idx, THR, MISS, LEFT, RIGHT, VAL = [], [], [], [], [], []
off = 0
for it in m._predictors:
    for k, pr in enumerate(it):
        nd = pr.nodes
        n = len(nd)
        assert not nd["is_categorical"].any()
        F_idx.append(np.where(nd["is_leaf"] == 1, -1, nd["feature_idx"]).astype(np.int16))
        THR.append(nd["num_threshold"].astype(np.float64))
        MISS.append(nd["missing_go_to_left"].astype(np.uint8))
        LEFT.append(nd["left"].astype(np.uint16))
        RIGHT.append(nd["right"].astype(np.uint16))
        VAL.append(nd["value"].astype(np.float32))
        trees_meta.append(off)
        off += n
entry = dict(
    features=feat_names, classes=[int(c) for c in m.classes_], baseline=[float(v) for v in m._baseline_prediction.ravel()],
    n_class=len(m.classes_), n_iter=int(m.n_iter_), offsets=trees_meta, n_nodes=off,
    f=b64(np.concatenate(F_idx)), thr=b64(np.concatenate(THR)), miss=b64(np.concatenate(MISS)),
    left=b64(np.concatenate(LEFT)), right=b64(np.concatenate(RIGHT)), val=b64(np.concatenate(VAL)),
    class_r={str(k): float(v) for k, v in d["class_r"].items()}, meta=d["meta"],
)
fc = joblib.load(os.path.join(home, "data/models/forecast.joblib"))
forecast = dict(tables={str(H): {str(b): v for b, v in tb.items()} for H, tb in fc["models"].items()}, meta=fc["meta"])

# ------------------------------------------------------------- escenarios
df = pd.read_parquet("/home/claude/q/m1n.parquet")
st = BarStore.from_frame(df, Clock(0, False, 0, 60))
feat = pd.read_pickle(f"{SCR}/feat.pkl")
T = pd.read_pickle(f"{SCR}/app_trades.pkl")
sc = ScenarioStats()
sc.fit(T, feat)
scen = dict(overall=sc.overall, table={"|".join(k): v for k, v in sc.table.items()})


def conv(o):
    if isinstance(o, dict):
        return {str(k): conv(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [conv(v) for v in o]
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, (np.floating, float)):
        return None if not np.isfinite(o) else round(float(o), 6)
    return o


js = json.dumps(conv(dict(entry=entry, forecast=forecast, scen=scen, version=int(d["meta"]["t"]))), separators=(",", ":"))
open(os.path.join(out_dir, "models.json"), "w").write(js)
print("models.json", round(len(js) / 1e6, 2), "MB")

# ------------------------------------------------------------- fixture de validación (no se publica)
if len(sys.argv) > 3:
    fx_dir = sys.argv[3]
    os.makedirs(fx_dir, exist_ok=True)
    n = len(st)
    a = n - 150000                       # ~5 meses de M1
    sub = st.ts[a:]
    bars = dict(ts=st.ts[a:].tolist(), o=st.o[a:].round(2).tolist(), h=st.h[a:].round(2).tolist(), l=st.l[a:].round(2).tolist(),
                c=st.c[a:].round(2).tolist(), sp=st.sp[a:].round(3).tolist(), v=st.vol[a:].tolist())
    st2 = BarStore(np.array(bars["ts"]), bars["o"], bars["h"], bars["l"], bars["c"], bars["sp"], Clock(0, False, 0, 60), vol=bars["v"])
    fe = F.compute(st2, 0, len(st2), warm=0)
    pick = np.r_[np.arange(len(st2) - 3000, len(st2), 37), np.arange(20000, len(st2), 5011)]
    rows = fe.iloc[pick]
    # probabilidades del modelo en esas filas
    from xauai.models import setup_matrix
    X = setup_matrix(rows, np.where(pick % 2 == 0, 1, -1), np.full(len(pick), 0.25), np.full(len(pick), 2.0), np.full(len(pick), 4.0))
    P = m.predict_proba(X)
    fx = dict(bars=bars, idx=pick.tolist(), feat={c: [None if not np.isfinite(v) else float(v) for v in rows[c].to_numpy()] for c in F.FEATURES},
              proba=P.round(6).tolist(), X=[[None if not np.isfinite(v) else float(v) for v in r] for r in X.to_numpy()],
              d_atr=[None if not np.isfinite(v) else float(v) for v in st2.d_atr], days=st2.days.tolist())
    open(os.path.join(fx_dir, "fixture.json"), "w").write(json.dumps(fx))
    print("fixture", len(pick), "filas")
