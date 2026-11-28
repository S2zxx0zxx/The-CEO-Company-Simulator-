package com.railwayceo.c06;

import static com.graphhopper.json.Statement.Else;
import static com.graphhopper.json.Statement.ElseIf;
import static com.graphhopper.json.Statement.If;
import static com.graphhopper.json.Statement.Op.LIMIT;
import static com.graphhopper.json.Statement.Op.MULTIPLY;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.graphhopper.GHRequest;
import com.graphhopper.GHResponse;
import com.graphhopper.GraphHopper;
import com.graphhopper.ResponsePath;
import com.graphhopper.config.Profile;
import com.graphhopper.jackson.Jackson;
import com.graphhopper.routing.ev.BooleanEncodedValue;
import com.graphhopper.routing.ev.DecimalEncodedValue;
import com.graphhopper.routing.ev.EnumEncodedValue;
import com.graphhopper.routing.ev.IntEncodedValue;
import com.graphhopper.routing.ev.OSMWayID;
import com.graphhopper.routing.ev.VehicleAccess;
import com.graphhopper.routing.util.EncodingManager;
import com.graphhopper.storage.BaseGraph;
import com.graphhopper.util.CustomModel;
import com.graphhopper.util.EdgeIteratorState;
import com.graphhopper.util.GHUtility;
import com.graphhopper.util.Instruction;
import com.graphhopper.util.InstructionList;
import com.graphhopper.util.Parameters.Algorithms;
import com.graphhopper.util.Parameters.CH;
import com.graphhopper.util.PointList;
import com.graphhopper.util.TurnCostsConfig;
import com.graphhopper.util.details.PathDetail;
import com.graphhopper.util.shapes.GHPoint;

import de.geofabrik.railway_routing.RailwayHopper;
import de.geofabrik.railway_routing.ev.Electrified;
import de.geofabrik.railway_routing.ev.Frequency;
import de.geofabrik.railway_routing.ev.Gauge;
import de.geofabrik.railway_routing.ev.RailwayClass;
import de.geofabrik.railway_routing.ev.Voltage;
import com.railwayceo.c06.StrictEnums.StrictAccess;
import com.railwayceo.c06.StrictEnums.StrictElectrifiedState;
import com.railwayceo.c06.StrictEnums.StrictFreqState;
import com.railwayceo.c06.StrictEnums.StrictGaugeState;
import com.railwayceo.c06.StrictEnums.StrictRailwayHopper;

public final class StrictOracleRunner {
    private static final ObjectMapper MAPPER = Jackson.newObjectMapper();
    private static final String CACHE_IDENTITY_FILE = "c06_cache_identity.json";
    private static final String UPSTREAM_ENCODED =
        "gauge,voltage,electrified,frequency,road_environment,max_speed,rail_access,rail_average_speed,railway_class,railway_service,preferred_direction,osm_way_id";

    private static final class CacheIdentity {
        final String graphSha256;
        final String pbfSha256;
        final int graphNodes;
        final int graphEdges;
        final boolean valid;
        final String error;

        CacheIdentity(String graphSha256, String pbfSha256, int graphNodes, int graphEdges, boolean valid, String error) {
            this.graphSha256 = graphSha256;
            this.pbfSha256 = pbfSha256;
            this.graphNodes = graphNodes;
            this.graphEdges = graphEdges;
            this.valid = valid;
            this.error = error;
        }
    }

    private static String sha256Hex(Path p) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] bytes = Files.readAllBytes(p);
        return HexFormat.of().formatHex(md.digest(bytes));
    }

    private static CacheIdentity loadAndVerifyCacheIdentity(String strictCacheDir, GraphHopper strictHopper) {
        if (strictCacheDir == null || strictHopper == null) {
            return new CacheIdentity("", "", 0, 0, false, "STRICT_CACHE_UNAVAILABLE");
        }
        Path manifestPath = Paths.get(strictCacheDir, CACHE_IDENTITY_FILE);
        BaseGraph bg = strictHopper.getBaseGraph();
        int loadedNodes = bg.getNodes();
        int loadedEdges = bg.getEdges();
        if (!Files.isRegularFile(manifestPath)) {
            return new CacheIdentity("", "", loadedNodes, loadedEdges, false, "MISSING_CACHE_IDENTITY_MANIFEST");
        }
        try {
            JsonNode n = MAPPER.readTree(manifestPath.toFile());
            String gSha = n.path("graphSha256").asText("");
            String pSha = n.path("pbfSha256").asText("");
            int mNodes = n.path("graphNodes").asInt(-1);
            int mEdges = n.path("graphEdges").asInt(-1);
            if (gSha.isEmpty() || pSha.isEmpty() || mNodes != loadedNodes || mEdges != loadedEdges) {
                return new CacheIdentity(
                    gSha, pSha, loadedNodes, loadedEdges, false,
                    "CACHE_GRAPH_DIMENSION_MISMATCH: expected=(" + mNodes + "," + mEdges + ") actual=(" + loadedNodes + "," + loadedEdges + ")"
                );
            }
            return new CacheIdentity(gSha, pSha, loadedNodes, loadedEdges, true, "");
        } catch (Exception ex) {
            return new CacheIdentity("", "", loadedNodes, loadedEdges, false, "INVALID_CACHE_IDENTITY_MANIFEST: " + ex.getMessage());
        }
    }

    private static CustomModel baseStrictModel() {
        return new CustomModel()
            .addToPriority(If("!rail_access || (railway_class != RAIL && railway_class != NARROW_GAUGE)", MULTIPLY, "0"))
            .addToSpeed(If("strict_maxspeed_known", LIMIT, "strict_maxspeed_kmh"))
            .addToSpeed(Else(LIMIT, "1"));
    }

    private static CustomModel buildUpstreamModel(boolean electric, int maxSpeedKmh, boolean filter1435Only) {
        CustomModel cm = new CustomModel()
            .addToPriority(If("!rail_access || railway_class != RAIL", MULTIPLY, "0"))
            .addToPriority(If("!preferred_direction", MULTIPLY, "0.5"))
            .addToSpeed(If("true", LIMIT, "rail_average_speed"))
            .addToSpeed(If("true", LIMIT, Integer.toString(maxSpeedKmh)));
        if (filter1435Only) {
            cm.addToSpeed(If("gauge != 0 && gauge != 1435", MULTIPLY, "0.0"));
        }
        if (electric) {
            cm.addToSpeed(If("!(electrified == CONTACT_LINE || electrified == UNSET)", MULTIPLY, "0.0"))
              .addToSpeed(ElseIf("voltage >= 14000.0 && voltage <= 16000.0 && frequency >= 15.0 && frequency <= 17.5", MULTIPLY, "1.0"))
              .addToSpeed(ElseIf("voltage >= 24000.0 && voltage <= 26000.0 && frequency >= 47.5 && frequency <= 52.5", MULTIPLY, "1.0"))
              .addToSpeed(ElseIf("voltage >= 1400.0 && voltage <= 1600.0 && frequency == 0.0", MULTIPLY, "1.0"))
              .addToSpeed(ElseIf("voltage == 0.0 && frequency == 0.0", MULTIPLY, "1.0"))
              .addToSpeed(Else(MULTIPLY, "0.0"));
        }
        return cm;
    }

    private static GraphHopper openStrictHopper(String osmFile, String cacheDir, boolean forImport) {
        GraphHopper h = new StrictRailwayHopper()
            .setGraphHopperLocation(cacheDir)
            .setEncodedValuesString(StrictEnums.STRICT_ENCODED_VALUES_STRING)
            .setProfiles(
                new Profile("strict_no_rev")
                    .setTurnCostsConfig(new TurnCostsConfig(List.of("train"), TurnCostsConfig.INFINITE_U_TURN_COSTS))
                    .setCustomModel(baseStrictModel()),
                new Profile("strict_with_rev")
                    .setTurnCostsConfig(new TurnCostsConfig(List.of("train"), 300).setEnableUTurnTimes(true))
                    .setCustomModel(baseStrictModel())
            )
            .setStoreOnFlush(true);
        if (osmFile != null) {
            h.setOSMFile(osmFile);
        }
        h.setMinNetworkSize(0);
        if (forImport) {
            h.importAndClose();
            return null;
        }
        h.importOrLoad();
        return h;
    }

    private static GraphHopper openUpstreamHopper(String osmFile, String cacheDir, boolean forImport) {
        GraphHopper h = new RailwayHopper()
            .setGraphHopperLocation(cacheDir)
            .setEncodedValuesString(UPSTREAM_ENCODED)
            .setProfiles(
                new Profile("upstream_electric")
                    .setTurnCostsConfig(new TurnCostsConfig(List.of("train"), TurnCostsConfig.INFINITE_U_TURN_COSTS))
                    .setCustomModel(buildUpstreamModel(true, 160, false)),
                new Profile("upstream_electric_1435")
                    .setTurnCostsConfig(new TurnCostsConfig(List.of("train"), TurnCostsConfig.INFINITE_U_TURN_COSTS))
                    .setCustomModel(buildUpstreamModel(true, 160, true)),
                new Profile("upstream_diesel_1435")
                    .setTurnCostsConfig(new TurnCostsConfig(List.of("train"), TurnCostsConfig.INFINITE_U_TURN_COSTS))
                    .setCustomModel(buildUpstreamModel(false, 120, true)),
                new Profile("upstream_diesel")
                    .setTurnCostsConfig(new TurnCostsConfig(List.of("train"), TurnCostsConfig.INFINITE_U_TURN_COSTS))
                    .setCustomModel(buildUpstreamModel(false, 120, false))
            )
            .setStoreOnFlush(true);
        if (osmFile != null) {
            h.setOSMFile(osmFile);
        }
        h.setMinNetworkSize(0);
        if (forImport) {
            h.importAndClose();
            return null;
        }
        h.importOrLoad();
        return h;
    }

    private static long dirSizeBytes(Path dir) throws Exception {
        if (!Files.exists(dir)) return 0L;
        try (var s = Files.walk(dir)) {
            return s.filter(Files::isRegularFile).mapToLong(p -> {
                try { return Files.size(p); } catch (Exception e) { return 0L; }
            }).sum();
        }
    }

    private static CustomModel buildStrictRequestModel(JsonNode req) {
        CustomModel cm = new CustomModel();
        String objective = req.path("objective").asText("time");
        cm.setDistanceInfluence("distance".equals(objective) ? 1000000.0 : 0.0);

        int maxSpeedKmh = req.path("train").path("maxSpeedKmh").asInt(160);
        cm.addToSpeed(If("true", LIMIT, Integer.toString(maxSpeedKmh)));

        // Fail-closed strict Realism preconditions
        cm.addToPriority(If(
            "!strict_active || strict_access != ALLOWED || !strict_oneway_dir || strict_gauge_state != KNOWN || !strict_maxspeed_known",
            MULTIPLY, "0"
        ));

        // Gauge match against allowed train gauges
        ArrayNode gaugesNode = (ArrayNode) req.path("train").path("gaugesMm");
        if (gaugesNode == null || gaugesNode.isEmpty()) {
            cm.addToPriority(If("true", MULTIPLY, "0"));
            return cm;
        }
        List<String> gConds = new ArrayList<>();
        for (JsonNode g : gaugesNode) {
            gConds.add("strict_gauge_mm == " + g.asInt());
        }
        cm.addToPriority(If("!(" + String.join(" || ", gConds) + ")", MULTIPLY, "0"));

        // Traction & strict electrical rules
        String traction = req.path("train").path("traction").asText("");
        ArrayNode voltsNode = (ArrayNode) req.path("train").path("voltagesV");
        ArrayNode freqsNode = (ArrayNode) req.path("train").path("frequenciesHz");

        if ("diesel".equals(traction) || "steam".equals(traction)) {
            // Diesel/steam may traverse non-electrified, electrified, or unknown electrification tracks; no electrical assertion.
            return cm;
        }

        // Compute allowed electrical condition from strict voltage + strict frequency state/deci-Hz
        List<String> elecClauses = new ArrayList<>();
        if (voltsNode != null && freqsNode != null && voltsNode.size() > 0 && freqsNode.size() > 0) {
            // In R08/GraphHopper, ambiguous multi-voltage x multi-frequency train profile fails closed upstream in adapter
            for (JsonNode v : voltsNode) {
                int vv = v.asInt();
                for (JsonNode f : freqsNode) {
                    int fHz = f.asInt();
                    String fCond = (fHz == 0)
                        ? "strict_freq_state == KNOWN_DC"
                        : ("strict_freq_state == KNOWN_AC && strict_freq_dhz == " + (fHz * 10));
                    elecClauses.add("(strict_electrified_state == YES && strict_voltage_known && strict_voltage_v == " + vv + " && " + fCond + ")");
                }
            }
        }
        String validElecExpr = elecClauses.isEmpty() ? "false" : String.join(" || ", elecClauses);

        if ("electric".equals(traction)) {
            cm.addToPriority(If("!(" + validElecExpr + ")", MULTIPLY, "0"));
        } else if ("dual".equals(traction)) {
            // Dual train in Oracle graph search can use electric OR diesel-compatible track;
            // exact mode-change switch site permission is checked & enforced strictly on path steps.
            cm.addToPriority(If("true", MULTIPLY, "1"));
        } else {
            cm.addToPriority(If("true", MULTIPLY, "0"));
        }
        return cm;
    }

    private static ObjectNode inspectQuery(GraphHopper strictHopper, GraphHopper upstreamHopper, CacheIdentity cacheId, JsonNode req) {
        ObjectNode out = MAPPER.createObjectNode();
        out.put("requestId", req.path("requestId").asText(""));
        if (req.hasNonNull("correlationNonce")) {
            out.put("correlationNonce", req.path("correlationNonce").asText(""));
        }
        String engineMode = req.path("engineMode").asText("STRICT_ORACLE");
        out.put("engineMode", engineMode);
        if (cacheId != null) {
            out.put("loadedGraphSha256", cacheId.graphSha256);
            out.put("loadedPbfSha256", cacheId.pbfSha256);
            out.put("loadedGraphNodes", cacheId.graphNodes);
            out.put("loadedGraphEdges", cacheId.graphEdges);
        }

        long t0 = System.nanoTime();
        try {
            int hangMs = req.path("simulateHangMs").asInt(0);
            if (hangMs > 0) {
                Thread.sleep(hangMs);
            }
            boolean isUpstreamBaseline = "UPSTREAM_UNMODIFIED".equals(engineMode);
            if (!isUpstreamBaseline) {
                if (cacheId == null || !cacheId.valid) {
                    out.put("ok", false);
                    out.put("statusCode", "STALE_GRAPH");
                    out.put("reason", cacheId == null ? "CACHE_IDENTITY_UNAVAILABLE" : cacheId.error);
                    out.put("elapsedMs", (System.nanoTime() - t0) / 1e6);
                    return out;
                }
                String expectedG = req.path("expectedGraphSha256").asText("");
                String actualG = req.path("actualGraphSha256").asText("");
                if ((!expectedG.isEmpty() && !expectedG.equals(cacheId.graphSha256)) ||
                    (!actualG.isEmpty() && !actualG.equals(cacheId.graphSha256)) ||
                    (!expectedG.isEmpty() && !actualG.isEmpty() && !expectedG.equals(actualG))) {
                    out.put("ok", false);
                    out.put("statusCode", "STALE_GRAPH");
                    out.put("reason", "CACHE_GRAPH_SHA256_MISMATCH: loaded=" + cacheId.graphSha256 + " expected=" + expectedG + " actual=" + actualG);
                    out.put("elapsedMs", (System.nanoTime() - t0) / 1e6);
                    return out;
                }
            }
            ArrayNode ptsNode = (ArrayNode) req.path("stops");
            if (ptsNode == null || ptsNode.size() < 2) {
                out.put("ok", false);
                out.put("statusCode", "INVALID_INPUT");
                out.put("reason", "AT_LEAST_2_STOPS_REQUIRED");
                out.put("elapsedMs", (System.nanoTime() - t0) / 1e6);
                return out;
            }
            List<GHPoint> points = new ArrayList<>();
            for (JsonNode p : ptsNode) {
                points.add(new GHPoint(p.get("lat").asDouble(), p.get("lon").asDouble()));
            }

            GraphHopper activeHopper = isUpstreamBaseline ? upstreamHopper : strictHopper;
            if (activeHopper == null) {
                out.put("ok", false);
                out.put("statusCode", "ORACLE_EXECUTION_ERROR");
                out.put("reason", "REQUESTED_HOPPER_NOT_LOADED");
                out.put("elapsedMs", (System.nanoTime() - t0) / 1e6);
                return out;
            }

            // R08 ambiguous power-pair safeguard (multi-voltage & multi-frequency on train profile)
            if (!isUpstreamBaseline) {
                String tr = req.path("train").path("traction").asText("");
                int nV = req.path("train").path("voltagesV").size();
                int nF = req.path("train").path("frequenciesHz").size();
                if (("electric".equals(tr) || "dual".equals(tr)) && nV > 1 && nF > 1) {
                    out.put("ok", false);
                    out.put("statusCode", "DATA_MISSING");
                    out.put("reason", "AMBIGUOUS_TRAIN_POWER_PAIRS");
                    out.put("elapsedMs", (System.nanoTime() - t0) / 1e6);
                    return out;
                }
            }

            boolean allowReversal = req.path("allowReversal").asBoolean(false);
            String profileName;
            if (isUpstreamBaseline) {
                profileName = req.path("upstreamProfile").asText("upstream_electric");
            } else {
                profileName = allowReversal ? "strict_with_rev" : "strict_no_rev";
            }

            GHRequest ghReq = new GHRequest(points)
                .setProfile(profileName)
                .setAlgorithm(Algorithms.DIJKSTRA_BI)
                .setPathDetails(List.of("edge_key", "osm_way_id"));
            ghReq.putHint(CH.DISABLE, true);
            if (!isUpstreamBaseline) {
                ghReq.setCustomModel(buildStrictRequestModel(req));
            }

            GHResponse rsp = activeHopper.route(ghReq);
            if (rsp.hasErrors()) {
                out.put("ok", false);
                String errText = rsp.getErrors().toString();
                out.put("statusCode", "NO_ROUTE");
                out.put("reason", errText);
                out.put("elapsedMs", (System.nanoTime() - t0) / 1e6);
                return out;
            }

            ResponsePath best = rsp.getBest();
            double maxRangeM = req.path("train").path("rangeM").asDouble(Double.POSITIVE_INFINITY);
            if (!isUpstreamBaseline && Double.isFinite(maxRangeM) && best.getDistance() > maxRangeM) {
                out.put("ok", false);
                out.put("statusCode", "INCOMPATIBLE_PROFILE");
                out.put("reason", "RANGE_EXCEEDED: distanceM=" + best.getDistance() + " > rangeM=" + maxRangeM);
                out.put("rawDistanceM", best.getDistance());
                out.put("elapsedMs", (System.nanoTime() - t0) / 1e6);
                return out;
            }
            int reversalCount = 0;
            InstructionList insns = best.getInstructions();
            for (Instruction ins : insns) {
                if (ins.getSign() == Instruction.U_TURN_UNKNOWN || ins.getSign() == Instruction.U_TURN_LEFT || ins.getSign() == Instruction.U_TURN_RIGHT) {
                    reversalCount++;
                }
            }
            List<PathDetail> edgeKeys = best.getPathDetails().get("edge_key");
            BaseGraph graph = activeHopper.getBaseGraph();
            int edgeReversalCount = 0;
            if (edgeKeys != null && edgeKeys.size() > 1) {
                for (int i = 1; i < edgeKeys.size(); i++) {
                    int prevKey = ((Number) edgeKeys.get(i - 1).getValue()).intValue();
                    int nextKey = ((Number) edgeKeys.get(i).getValue()).intValue();
                    EdgeIteratorState prevE = graph.getEdgeIteratorStateForKey(prevKey);
                    EdgeIteratorState nextE = graph.getEdgeIteratorStateForKey(nextKey);
                    if (prevE.getEdge() == nextE.getEdge() && prevE.getAdjNode() == nextE.getBaseNode() && prevE.getBaseNode() == nextE.getAdjNode()) {
                        edgeReversalCount++;
                    }
                }
            }
            int effectiveReversals = Math.max(reversalCount, edgeReversalCount);
            if (!isUpstreamBaseline && !allowReversal && effectiveReversals > 0) {
                out.put("ok", false);
                out.put("statusCode", "NO_ROUTE");
                out.put("reason", "UNAUTHORIZED_REVERSAL_AT_STOP: reversals=" + effectiveReversals);
                out.put("elapsedMs", (System.nanoTime() - t0) / 1e6);
                return out;
            }

            out.put("ok", true);
            out.put("statusCode", "OK");
            out.put("distanceM", best.getDistance());
            out.put("durationMs", best.getTime());
            out.put("durationS", Math.ceil(best.getTime() / 1000.0));
            out.put("visitedNodes", rsp.getHints().getLong("visited_nodes.sum", 0));

            PointList wps = best.getWaypoints();
            ArrayNode wpArr = MAPPER.createArrayNode();
            for (int i = 0; i < wps.size(); i++) {
                ObjectNode wp = MAPPER.createObjectNode();
                wp.put("lat", wps.getLat(i));
                wp.put("lon", wps.getLon(i));
                wpArr.add(wp);
            }
            out.set("snappedWaypoints", wpArr);
            out.put("reversalCount", effectiveReversals);

            // Extract every traversed GraphHopper edge and its actual encoded values
            EncodingManager em = activeHopper.getEncodingManager();
            IntEncodedValue osmWayEnc = em.getIntEncodedValue(OSMWayID.KEY);
            IntEncodedValue gaugeEnc = em.getIntEncodedValue(Gauge.KEY);
            DecimalEncodedValue voltEnc = em.getDecimalEncodedValue(Voltage.KEY);
            DecimalEncodedValue freqEnc = em.getDecimalEncodedValue(Frequency.KEY);
            EnumEncodedValue<Electrified> elEnc = em.getEnumEncodedValue(Electrified.KEY, Electrified.class);

            ArrayNode edgesArr = MAPPER.createArrayNode();
            if (edgeKeys != null) {
                for (PathDetail pd : edgeKeys) {
                    int edgeKey = ((Number) pd.getValue()).intValue();
                    EdgeIteratorState e = graph.getEdgeIteratorStateForKey(edgeKey);
                    ObjectNode en = MAPPER.createObjectNode();
                    en.put("edgeKey", edgeKey);
                    en.put("edgeId", e.getEdge());
                    en.put("osmWayId", e.get(osmWayEnc));
                    en.put("baseNode", e.getBaseNode());
                    en.put("adjNode", e.getAdjNode());
                    en.put("distanceM", e.getDistance());
                    en.put("upstreamGaugeMm", e.get(gaugeEnc));
                    en.put("upstreamElectrified", e.get(elEnc).toString());
                    en.put("upstreamVoltageV", e.get(voltEnc));
                    en.put("upstreamFrequencyHz", e.get(freqEnc));

                    if (!isUpstreamBaseline && em.hasEncodedValue(StrictAccess.KEY)) {
                        en.put("strictAccess", e.get(em.getEnumEncodedValue(StrictAccess.KEY, StrictAccess.class)).toString());
                        en.put("strictActive", e.get(em.getBooleanEncodedValue(StrictEnums.KEY_STRICT_ACTIVE)));
                        en.put("strictGaugeState", e.get(em.getEnumEncodedValue(StrictGaugeState.KEY, StrictGaugeState.class)).toString());
                        en.put("strictGaugeMm", e.get(em.getIntEncodedValue(StrictEnums.KEY_STRICT_GAUGE_MM)));
                        en.put("strictElectrifiedState", e.get(em.getEnumEncodedValue(StrictElectrifiedState.KEY, StrictElectrifiedState.class)).toString());
                        en.put("strictVoltageKnown", e.get(em.getBooleanEncodedValue(StrictEnums.KEY_STRICT_VOLTAGE_KNOWN)));
                        en.put("strictVoltageV", e.get(em.getIntEncodedValue(StrictEnums.KEY_STRICT_VOLTAGE_V)));
                        en.put("strictFreqState", e.get(em.getEnumEncodedValue(StrictFreqState.KEY, StrictFreqState.class)).toString());
                        en.put("strictFreqDhz", e.get(em.getIntEncodedValue(StrictEnums.KEY_STRICT_FREQ_DHZ)));
                        en.put("strictMaxSpeedKnown", e.get(em.getBooleanEncodedValue(StrictEnums.KEY_STRICT_MAXSPEED_KNOWN)));
                        en.put("strictMaxSpeedKmh", e.get(em.getIntEncodedValue(StrictEnums.KEY_STRICT_MAXSPEED_KMH)));
                        en.put("strictOnewayAllowed", e.get(em.getBooleanEncodedValue(StrictEnums.KEY_STRICT_ONEWAY_DIR)));
                    }
                    edgesArr.add(en);
                }
            }
            out.set("edges", edgesArr);
            out.put("elapsedMs", (System.nanoTime() - t0) / 1e6);
            return out;
        } catch (Exception ex) {
            out.put("ok", false);
            out.put("statusCode", "ORACLE_EXECUTION_ERROR");
            out.put("reason", ex.getClass().getSimpleName() + ": " + ex.getMessage());
            out.put("elapsedMs", (System.nanoTime() - t0) / 1e6);
            return out;
        }
    }

    private static Map<String, String> parseArgs(String[] args) {
        Map<String, String> map = new LinkedHashMap<>();
        for (int i = 1; i < args.length - 1; i += 2) {
            if (args[i].startsWith("--")) {
                map.put(args[i].substring(2), args[i + 1]);
            }
        }
        return map;
    }

    public static void main(String[] args) throws Exception {
        PrintStream jsonOut = System.out;
        System.setOut(System.err);
        if (args.length == 0) {
            System.err.println("Usage: StrictOracleRunner <import|query-stdio|query-once> [--key val ...]");
            System.exit(2);
        }
        String cmd = args[0];
        Map<String, String> opts = parseArgs(args);

        if ("import".equals(cmd)) {
            String pbf = opts.get("pbf");
            String strictCache = opts.get("strict-cache");
            String upstreamCache = opts.get("upstream-cache");
            long tStrict0 = System.nanoTime();
            openStrictHopper(pbf, strictCache, true);
            long tStrict1 = System.nanoTime();

            long tUp0 = System.nanoTime();
            if (upstreamCache != null) {
                openUpstreamHopper(pbf, upstreamCache, true);
            }
            long tUp1 = System.nanoTime();

            GraphHopper verifyLoaded = openStrictHopper(null, strictCache, false);
            BaseGraph bg = verifyLoaded.getBaseGraph();
            int nodes = bg.getNodes();
            int edges = bg.getEdges();
            verifyLoaded.close();

            String pbfSha = sha256Hex(Paths.get(pbf));
            String graphSha = opts.getOrDefault("graph-sha256", "");
            ObjectNode cacheManifest = MAPPER.createObjectNode();
            cacheManifest.put("schemaVersion", 1);
            cacheManifest.put("graphSha256", graphSha);
            cacheManifest.put("pbfSha256", pbfSha);
            cacheManifest.put("graphNodes", nodes);
            cacheManifest.put("graphEdges", edges);
            cacheManifest.put("strictEncodedValues", StrictEnums.STRICT_ENCODED_VALUES_STRING);
            Files.writeString(
                Paths.get(strictCache, CACHE_IDENTITY_FILE),
                MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(cacheManifest) + "\n",
                StandardCharsets.UTF_8
            );

            Runtime rt = Runtime.getRuntime();
            ObjectNode res = MAPPER.createObjectNode();
            res.put("ok", true);
            res.put("pbfPath", pbf);
            res.put("pbfSha256", pbfSha);
            res.put("graphSha256", graphSha);
            res.put("strictImportDurationMs", Math.round((tStrict1 - tStrict0) / 1e4) / 100.0);
            res.put("upstreamImportDurationMs", upstreamCache != null ? Math.round((tUp1 - tUp0) / 1e4) / 100.0 : 0.0);
            res.put("strictCacheBytes", dirSizeBytes(Paths.get(strictCache)));
            res.put("upstreamCacheBytes", upstreamCache != null ? dirSizeBytes(Paths.get(upstreamCache)) : 0L);
            res.put("graphNodes", nodes);
            res.put("graphEdges", edges);
            res.put("jvmMaxHeapBytes", rt.maxMemory());
            res.put("jvmTotalHeapBytes", rt.totalMemory());
            String json = MAPPER.writeValueAsString(res);
            if (opts.containsKey("out")) {
                Files.writeString(Paths.get(opts.get("out")), json + "\n", StandardCharsets.UTF_8);
            }
            jsonOut.println(json);
            jsonOut.flush();
            return;
        }

        if ("query-once".equals(cmd)) {
            long tStart = System.nanoTime();
            GraphHopper strictHopper = openStrictHopper(null, opts.get("strict-cache"), false);
            CacheIdentity cacheId = loadAndVerifyCacheIdentity(opts.get("strict-cache"), strictHopper);
            GraphHopper upstreamHopper = opts.containsKey("upstream-cache")
                ? openUpstreamHopper(null, opts.get("upstream-cache"), false)
                : null;
            double startupMs = Math.round((System.nanoTime() - tStart) / 1e4) / 100.0;
            JsonNode req = MAPPER.readTree(new File(opts.get("req")));
            ObjectNode out = inspectQuery(strictHopper, upstreamHopper, cacheId, req);
            out.put("startupLoadMs", startupMs);
            jsonOut.println(MAPPER.writeValueAsString(out));
            jsonOut.flush();
            strictHopper.close();
            if (upstreamHopper != null) upstreamHopper.close();
            return;
        }

        if ("query-stdio".equals(cmd)) {
            long tStart = System.nanoTime();
            GraphHopper strictHopper = openStrictHopper(null, opts.get("strict-cache"), false);
            CacheIdentity cacheId = loadAndVerifyCacheIdentity(opts.get("strict-cache"), strictHopper);
            GraphHopper upstreamHopper = opts.containsKey("upstream-cache")
                ? openUpstreamHopper(null, opts.get("upstream-cache"), false)
                : null;
            double startupMs = Math.round((System.nanoTime() - tStart) / 1e4) / 100.0;
            Runtime rt = Runtime.getRuntime();
            ObjectNode ready = MAPPER.createObjectNode();
            ready.put("type", "ready");
            ready.put("startupLoadMs", startupMs);
            ready.put("jvmMaxHeapBytes", rt.maxMemory());
            ready.put("jvmUsedHeapBytes", rt.totalMemory() - rt.freeMemory());
            ready.put("loadedGraphSha256", cacheId.graphSha256);
            ready.put("loadedPbfSha256", cacheId.pbfSha256);
            ready.put("graphNodes", cacheId.graphNodes);
            ready.put("graphEdges", cacheId.graphEdges);
            ready.put("cacheIdentityValid", cacheId.valid);
            jsonOut.println(MAPPER.writeValueAsString(ready));
            jsonOut.flush();

            try (BufferedReader br = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) {
                    if (line.trim().isEmpty()) continue;
                    JsonNode req = MAPPER.readTree(line);
                    ObjectNode out = inspectQuery(strictHopper, upstreamHopper, cacheId, req);
                    jsonOut.println(MAPPER.writeValueAsString(out));
                    jsonOut.flush();
                }
            } finally {
                strictHopper.close();
                if (upstreamHopper != null) upstreamHopper.close();
            }
            return;
        }

        throw new IllegalArgumentException("Unknown command: " + cmd);
    }
}
