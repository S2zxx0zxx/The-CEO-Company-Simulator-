#!/usr/bin/env python3
"""Offline research oracle runner. Requires the exact C01 checkout, not a PyPI substitute."""
import argparse
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
from decimal import Decimal

PIN = "aecad5e702403c3a39947e7668af54ebfaefddd5"
TREE = "d05bc45192ce2f2fafa5719df467db793419fa22"
FILES = {
    "LICENSE.md": "0421455a13bf647697101d20757f61d24e00edaf",
    "python/altrios/resources/networks/simple_corridor_network.yaml": "e7a1fe2f51ce72f24164f226cd185bdaacde8f1b",
    "python/altrios/resources/networks/simple_corridor_locations.csv": "149eef7cf8e0167c56ecb5a5477b75131261dede",
    "python/altrios/resources/rolling_stock/Manifest_Loaded.yaml": "99a923a994a39510ac0d06f77bb95136e0eca0e2",
    "python/altrios/resources/rolling_stock/Manifest_Empty.yaml": "d1699d1463881498d10bbf88913854b5aa60759f",
    "python/altrios/resources/metrics_inputs/GREET-CA_Emissions_Factors.csv": "2867944ed91464d79e717617186ac9f95147b009",
}
def digest(data):
    return hashlib.sha256(data).hexdigest()
def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()
def require(ok, message):
    if not ok:
        raise ValueError(message)
def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
def finite(value):
    value = float(value)
    require(math.isfinite(value), "non-finite oracle value")
    return value
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkout", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--cases", type=Path, default=Path(__file__).with_name("cases.json"))
    ns = ap.parse_args()
    root = ns.checkout.resolve()
    require(git(root, "rev-parse", "HEAD") == PIN, "wrong upstream commit")
    require(git(root, "rev-parse", "HEAD^{tree}") == TREE, "wrong upstream tree")
    require(not git(root, "status", "--porcelain", "--untracked-files=no"), "modified upstream tracked source")
    source_hashes = {}
    for name, blob in FILES.items():
        data = (root / name).read_bytes()
        require(hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest() == blob, f"source mismatch {name}")
        source_hashes[name] = digest(data)
    require(sys.version_info[:2] in ((3, 10), (3, 11)), "upstream Python range 3.10–3.11")
    import altrios as alt
    import yaml
    # Confirm Python and native extension originate from the wheel built by the workflow.
    import altrios.altrios_pyo3 as native
    resources = Path(alt.resources_root())
    for name in FILES:
        if "/resources/" in name:
            path = resources / name.split("/resources/", 1)[1]
            require(digest(path.read_bytes()) == source_hashes[name], f"installed resource differs: {name}")
    with (resources / "metrics_inputs/GREET-CA_Emissions_Factors.csv").open(newline="") as file:
        fuels = [r for r in csv.DictReader(file) if r["Name"] == "ultra low sulfur diesel"]
    require(len(fuels) == 1 and fuels[0]["Density Units"] == "[g/gal]", "ambiguous fuel conversion")
    # Upstream metric_calculator uses MJ/kg and g per US gallon. Exact US gallon = 3785.411784 mL.
    j_per_ml = Decimal(fuels[0]["LowHeatingValue"]) * Decimal(1000) * Decimal(fuels[0]["Density"]) / Decimal("3785.411784")
    network_file = resources / "networks/simple_corridor_network.yaml"
    with network_file.open() as file:
        network_yaml = yaml.safe_load(file)
    links = [x for x in network_yaml[1] if x["idx_curr"] != 0]
    speed_limits = {Decimal(str(y["speed_meters_per_second"])) for x in links for y in x["speed_set"]["speed_limits"]}
    require(len(speed_limits) == 1, "this comparison requires uniform source speed ceiling")
    speed_mps = speed_limits.pop()
    speed_kmh = int(speed_mps * Decimal("3.6"))
    manifest_bytes = ns.cases.read_bytes()
    manifest = json.loads(manifest_bytes)
    require(manifest["schemaVersion"] == 1 and manifest["status"] == "RESEARCH_ONLY", "invalid experiment scope")
    require(len({x["id"] for x in manifest["cases"]}) == len(manifest["cases"]), "duplicate case")
    rows = []
    ns.out.mkdir(parents=True, exist_ok=False)
    for c in manifest["cases"]:
        require(c["split"] in ("fit", "holdout") and c["origin"] != c["destination"], "invalid case")
        loaded = alt.RailVehicle.from_file(resources / "rolling_stock/Manifest_Loaded.yaml")
        empty = alt.RailVehicle.from_file(resources / "rolling_stock/Manifest_Empty.yaml")
        train = alt.TrainConfig(rail_vehicles=[loaded, empty], n_cars_by_type={"Manifest_Loaded": c["loadedCars"], "Manifest_Empty": c["emptyCars"]}, train_length_meters=None, train_mass_kilograms=None)
        locos = [alt.Locomotive.default() for _ in range(c["locomotives"])]
        require(all("ConventionalLoco" in x.to_pydict()["loco_type"] for x in locos), "not conventional diesel")
        consist = alt.Consist(locos, 1)
        builder = alt.TrainSimBuilder(train_id=c["id"], origin_id=c["origin"], destination_id=c["destination"], train_config=train, loco_con=consist)
        network = alt.Network.from_file(network_file)
        locations = alt.import_locations(resources / "networks/simple_corridor_locations.csv")
        sim = builder.make_speed_limit_train_sim(location_map=locations, save_interval=1)
        sim.set_save_interval(1)
        times, _ = alt.make_est_times(sim, network)
        path = alt.run_dispatch(network, alt.SpeedLimitTrainSimVec([sim]), [times], False, False)[0]
        sim.walk_timed_path(network=network, timed_path=path)
        history = sim.to_pydict()["history"]
        ts = [finite(x) for x in history["time_seconds"]]
        ds = [finite(x) for x in history["total_dist_meters"]]
        vs = [finite(x) for x in history["speed_meters_per_second"]]
        require(len(ts) == len(ds) == len(vs) and len(ts) > 2, "invalid history length")
        require(all(a <= b for a,b in zip(ts,ts[1:])) and all(a <= b for a,b in zip(ds,ds[1:])), "nonmonotonic history")
        fuel = finite(sim.get_energy_fuel_joules(False))
        distance = ds[-1] - ds[0]
        duration = ts[-1] - ts[0]
        require(fuel > 0 and distance > 0 and duration > 0, "empty or invalid result")
        trace = {"timeSeconds": ts, "distanceMetres": ds, "speedMps": vs}
        trace_bytes = canonical(trace)
        (ns.out / (c["id"] + ".trace.json")).write_bytes(trace_bytes)
        # Only training traces can determine ramp durations. Holdout traces are not read by the fit.
        reached = [i for i,v in enumerate(vs) if v >= float(speed_mps)*0.99]
        ramp = None
        if abs(vs[0]) <= 0.01 and abs(vs[-1]) <= 0.01 and reached:
            ramp = {"accelerationS": max(1, math.ceil(ts[reached[0]] - ts[0])), "brakingS": max(1, math.ceil(ts[-1] - ts[reached[-1]]))}
        rows.append({**c,"inputSha256":digest(canonical(c)), "traceSha256":digest(trace_bytes),
            "distanceM":round(distance), "durationS":duration, "fuelJ":fuel,
            "sourceSpeedKmh":speed_kmh, "ramp":ramp,
            "massKg":finite(history["mass_static_kilograms"][-1]),
            "maxSpeedMps":max(vs), "startSpeedMps":vs[0], "endSpeedMps":vs[-1]})
        print("R37_ORACLE_ROW "+canonical(rows[-1]).decode(), flush=True)
    result = {"schemaVersion":1,"kind":"EXECUTED_ALTRIOS_RESEARCH","commit":PIN,"tree":TREE,
        "manifestSha256":digest(manifest_bytes),"sourceSha256":source_hashes,
        "nativeSha256":digest(Path(native.__file__).read_bytes()), "python":sys.version.split()[0],
        "fuelJPerMl":float(j_per_ml), "fuelSource":"pinned GREET-CA ULSD 2020; not Indian diesel certification",
        "rows":rows}
    data = canonical(result)
    (ns.out / "oracle.json").write_bytes(data)
    print("R37_ORACLE_SHA256 "+digest(data), flush=True)
if __name__ == "__main__":
    main()
