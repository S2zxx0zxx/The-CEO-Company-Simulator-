package com.railwayceo.c06;

import java.util.Locale;

import com.graphhopper.reader.ReaderWay;
import com.graphhopper.routing.ev.BooleanEncodedValue;
import com.graphhopper.routing.ev.EdgeIntAccess;
import com.graphhopper.routing.ev.EnumEncodedValue;
import com.graphhopper.routing.ev.IntEncodedValue;
import com.graphhopper.routing.util.parsers.TagParser;
import com.graphhopper.storage.IntsRef;

import de.geofabrik.railway_routing.parsers.OSMRailwayMaxSpeedParser;

import com.railwayceo.c06.StrictEnums.StrictAccess;
import com.railwayceo.c06.StrictEnums.StrictElectrifiedState;
import com.railwayceo.c06.StrictEnums.StrictFreqState;
import com.railwayceo.c06.StrictEnums.StrictGaugeState;

public final class StrictParsers {
    private StrictParsers() {}

    public static final class NoOpTagParser implements TagParser {
        @Override
        public void handleWayTags(int edgeId, EdgeIntAccess edgeIntAccess, ReaderWay way, IntsRef relationFlags) {
            // Populated atomically by companion presence parser.
        }
    }

    public static final class StrictAccessParser implements TagParser {
        private final EnumEncodedValue<StrictAccess> enc;
        public StrictAccessParser(EnumEncodedValue<StrictAccess> enc) { this.enc = enc; }

        @Override
        public void handleWayTags(int edgeId, EdgeIntAccess edgeIntAccess, ReaderWay way, IntsRef relationFlags) {
            String raw = way.getTag("access");
            if (raw == null || raw.trim().isEmpty()) {
                enc.setEnum(false, edgeId, edgeIntAccess, StrictAccess.UNKNOWN);
                return;
            }
            String v = raw.trim().toLowerCase(Locale.ROOT);
            if ("allowed".equals(v) || "yes".equals(v) || "permissive".equals(v) || "public".equals(v) || "designated".equals(v)) {
                enc.setEnum(false, edgeId, edgeIntAccess, StrictAccess.ALLOWED);
            } else if ("restricted".equals(v) || "private".equals(v) || "no".equals(v) || "military".equals(v) || "customers".equals(v)) {
                enc.setEnum(false, edgeId, edgeIntAccess, StrictAccess.RESTRICTED);
            } else {
                enc.setEnum(false, edgeId, edgeIntAccess, StrictAccess.UNKNOWN);
            }
        }
    }

    public static final class StrictActiveParser implements TagParser {
        private final BooleanEncodedValue enc;
        public StrictActiveParser(BooleanEncodedValue enc) { this.enc = enc; }

        @Override
        public void handleWayTags(int edgeId, EdgeIntAccess edgeIntAccess, ReaderWay way, IntsRef relationFlags) {
            String activeTag = way.getTag("railway:active");
            if ("no".equalsIgnoreCase(activeTag) || "false".equalsIgnoreCase(activeTag) || "0".equals(activeTag)) {
                enc.setBool(false, edgeId, edgeIntAccess, false);
                return;
            }
            if (way.hasTag("disused:railway") || way.hasTag("abandoned:railway") || way.hasTag("construction:railway")) {
                enc.setBool(false, edgeId, edgeIntAccess, false);
                return;
            }
            String railTag = way.getTag("railway");
            if ("disused".equalsIgnoreCase(railTag) || "abandoned".equalsIgnoreCase(railTag) || "construction".equalsIgnoreCase(railTag)) {
                enc.setBool(false, edgeId, edgeIntAccess, false);
                return;
            }
            enc.setBool(false, edgeId, edgeIntAccess, true);
        }
    }

    public static final class StrictGaugeStateParser implements TagParser {
        private final EnumEncodedValue<StrictGaugeState> stateEnc;
        private final IntEncodedValue mmEnc;
        public StrictGaugeStateParser(EnumEncodedValue<StrictGaugeState> stateEnc, IntEncodedValue mmEnc) {
            this.stateEnc = stateEnc;
            this.mmEnc = mmEnc;
        }

        @Override
        public void handleWayTags(int edgeId, EdgeIntAccess edgeIntAccess, ReaderWay way, IntsRef relationFlags) {
            String raw = way.getTag("gauge");
            if (raw == null || raw.trim().isEmpty() || "unknown".equalsIgnoreCase(raw.trim())) {
                stateEnc.setEnum(false, edgeId, edgeIntAccess, StrictGaugeState.MISSING);
                mmEnc.setInt(false, edgeId, edgeIntAccess, 0);
                return;
            }
            try {
                int val = Integer.parseInt(raw.trim());
                if (val > 0 && val <= mmEnc.getMaxStorableInt()) {
                    stateEnc.setEnum(false, edgeId, edgeIntAccess, StrictGaugeState.KNOWN);
                    mmEnc.setInt(false, edgeId, edgeIntAccess, val);
                } else {
                    stateEnc.setEnum(false, edgeId, edgeIntAccess, StrictGaugeState.INVALID);
                    mmEnc.setInt(false, edgeId, edgeIntAccess, 0);
                }
            } catch (NumberFormatException e) {
                stateEnc.setEnum(false, edgeId, edgeIntAccess, StrictGaugeState.INVALID);
                mmEnc.setInt(false, edgeId, edgeIntAccess, 0);
            }
        }
    }

    public static final class StrictElectrifiedParser implements TagParser {
        private final EnumEncodedValue<StrictElectrifiedState> enc;
        public StrictElectrifiedParser(EnumEncodedValue<StrictElectrifiedState> enc) { this.enc = enc; }

        @Override
        public void handleWayTags(int edgeId, EdgeIntAccess edgeIntAccess, ReaderWay way, IntsRef relationFlags) {
            String raw = way.getTag("electrified");
            if (raw == null || raw.trim().isEmpty()) {
                enc.setEnum(false, edgeId, edgeIntAccess, StrictElectrifiedState.UNKNOWN);
                return;
            }
            String v = raw.trim().toLowerCase(Locale.ROOT);
            if ("contact_line".equals(v) || "rail".equals(v) || "yes".equals(v) || "3rd_rail".equals(v) || "4th_rail".equals(v)) {
                enc.setEnum(false, edgeId, edgeIntAccess, StrictElectrifiedState.YES);
            } else if ("no".equals(v)) {
                enc.setEnum(false, edgeId, edgeIntAccess, StrictElectrifiedState.NO);
            } else {
                enc.setEnum(false, edgeId, edgeIntAccess, StrictElectrifiedState.UNKNOWN);
            }
        }
    }

    public static final class StrictVoltageParser implements TagParser {
        private final BooleanEncodedValue knownEnc;
        private final IntEncodedValue voltsEnc;
        public StrictVoltageParser(BooleanEncodedValue knownEnc, IntEncodedValue voltsEnc) {
            this.knownEnc = knownEnc;
            this.voltsEnc = voltsEnc;
        }

        @Override
        public void handleWayTags(int edgeId, EdgeIntAccess edgeIntAccess, ReaderWay way, IntsRef relationFlags) {
            String raw = way.getTag("voltage");
            if (raw == null || raw.trim().isEmpty() || "unknown".equalsIgnoreCase(raw.trim())) {
                knownEnc.setBool(false, edgeId, edgeIntAccess, false);
                voltsEnc.setInt(false, edgeId, edgeIntAccess, 0);
                return;
            }
            String s = raw.trim().toLowerCase(Locale.ROOT);
            try {
                double volts;
                if (s.endsWith("kv")) {
                    volts = Double.parseDouble(s.substring(0, s.length() - 2).trim()) * 1000.0;
                } else if (s.endsWith("v")) {
                    volts = Double.parseDouble(s.substring(0, s.length() - 1).trim());
                } else {
                    volts = Double.parseDouble(s);
                }
                int iv = (int) Math.round(volts);
                if (volts > 0 && Math.abs(volts - iv) < 1e-6 && iv <= voltsEnc.getMaxStorableInt()) {
                    knownEnc.setBool(false, edgeId, edgeIntAccess, true);
                    voltsEnc.setInt(false, edgeId, edgeIntAccess, iv);
                } else {
                    knownEnc.setBool(false, edgeId, edgeIntAccess, false);
                    voltsEnc.setInt(false, edgeId, edgeIntAccess, 0);
                }
            } catch (NumberFormatException e) {
                knownEnc.setBool(false, edgeId, edgeIntAccess, false);
                voltsEnc.setInt(false, edgeId, edgeIntAccess, 0);
            }
        }
    }

    /** Resolves missing/unknown frequency vs explicit frequency=0 (DC) vs positive AC deci-Hz. */
    public static final class StrictFreqParser implements TagParser {
        private final EnumEncodedValue<StrictFreqState> stateEnc;
        private final IntEncodedValue dhzEnc;
        public StrictFreqParser(EnumEncodedValue<StrictFreqState> stateEnc, IntEncodedValue dhzEnc) {
            this.stateEnc = stateEnc;
            this.dhzEnc = dhzEnc;
        }

        @Override
        public void handleWayTags(int edgeId, EdgeIntAccess edgeIntAccess, ReaderWay way, IntsRef relationFlags) {
            String raw = way.getTag("frequency");
            if (raw == null || raw.trim().isEmpty()) {
                stateEnc.setEnum(false, edgeId, edgeIntAccess, StrictFreqState.MISSING);
                dhzEnc.setInt(false, edgeId, edgeIntAccess, 0);
                return;
            }
            String s = raw.trim().toLowerCase(Locale.ROOT);
            if ("unknown".equals(s)) {
                stateEnc.setEnum(false, edgeId, edgeIntAccess, StrictFreqState.INVALID);
                dhzEnc.setInt(false, edgeId, edgeIntAccess, 0);
                return;
            }
            if ("dc".equals(s) || "0hz".equals(s) || "0 hz".equals(s)) {
                stateEnc.setEnum(false, edgeId, edgeIntAccess, StrictFreqState.KNOWN_DC);
                dhzEnc.setInt(false, edgeId, edgeIntAccess, 0);
                return;
            }
            if (s.endsWith("hz")) {
                s = s.substring(0, s.length() - 2).trim();
            }
            try {
                double hz = Double.parseDouble(s);
                if (hz == 0.0) {
                    stateEnc.setEnum(false, edgeId, edgeIntAccess, StrictFreqState.KNOWN_DC);
                    dhzEnc.setInt(false, edgeId, edgeIntAccess, 0);
                } else if (hz > 0.0) {
                    int dhz = (int) Math.round(hz * 10.0);
                    if (dhz > 0 && dhz <= dhzEnc.getMaxStorableInt()) {
                        stateEnc.setEnum(false, edgeId, edgeIntAccess, StrictFreqState.KNOWN_AC);
                        dhzEnc.setInt(false, edgeId, edgeIntAccess, dhz);
                    } else {
                        stateEnc.setEnum(false, edgeId, edgeIntAccess, StrictFreqState.INVALID);
                        dhzEnc.setInt(false, edgeId, edgeIntAccess, 0);
                    }
                } else {
                    stateEnc.setEnum(false, edgeId, edgeIntAccess, StrictFreqState.INVALID);
                    dhzEnc.setInt(false, edgeId, edgeIntAccess, 0);
                }
            } catch (NumberFormatException e) {
                stateEnc.setEnum(false, edgeId, edgeIntAccess, StrictFreqState.INVALID);
                dhzEnc.setInt(false, edgeId, edgeIntAccess, 0);
            }
        }
    }

    public static final class StrictMaxSpeedParser implements TagParser {
        private final BooleanEncodedValue knownEnc;
        private final IntEncodedValue kmhEnc;
        public StrictMaxSpeedParser(BooleanEncodedValue knownEnc, IntEncodedValue kmhEnc) {
            this.knownEnc = knownEnc;
            this.kmhEnc = kmhEnc;
        }

        @Override
        public void handleWayTags(int edgeId, EdgeIntAccess edgeIntAccess, ReaderWay way, IntsRef relationFlags) {
            double sp = OSMRailwayMaxSpeedParser.parseMaxSpeed(way, false);
            int iv = (int) Math.round(sp);
            if (sp > 0 && iv >= 1 && iv <= kmhEnc.getMaxStorableInt()) {
                knownEnc.setBool(false, edgeId, edgeIntAccess, true);
                kmhEnc.setInt(false, edgeId, edgeIntAccess, iv);
            } else {
                knownEnc.setBool(false, edgeId, edgeIntAccess, false);
                kmhEnc.setInt(false, edgeId, edgeIntAccess, 0);
            }
        }
    }

    public static final class StrictOnewayParser implements TagParser {
        private final BooleanEncodedValue dirEnc;
        public StrictOnewayParser(BooleanEncodedValue dirEnc) { this.dirEnc = dirEnc; }

        @Override
        public void handleWayTags(int edgeId, EdgeIntAccess edgeIntAccess, ReaderWay way, IntsRef relationFlags) {
            String raw = way.getTag("oneway");
            boolean fwd = true;
            boolean bwd = true;
            if (raw != null) {
                String v = raw.trim().toLowerCase(Locale.ROOT);
                if ("yes".equals(v) || "true".equals(v) || "1".equals(v)) {
                    bwd = false;
                } else if ("-1".equals(v) || "reverse".equals(v)) {
                    fwd = false;
                }
            }
            dirEnc.setBool(false, edgeId, edgeIntAccess, fwd);
            dirEnc.setBool(true, edgeId, edgeIntAccess, bwd);
        }
    }
}
