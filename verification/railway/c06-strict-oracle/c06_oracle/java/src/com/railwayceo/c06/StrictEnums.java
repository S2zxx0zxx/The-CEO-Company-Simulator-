package com.railwayceo.c06;

import com.graphhopper.routing.ev.BooleanEncodedValue;
import com.graphhopper.routing.ev.EnumEncodedValue;
import com.graphhopper.routing.ev.ImportUnit;
import com.graphhopper.routing.ev.IntEncodedValue;
import com.graphhopper.routing.ev.IntEncodedValueImpl;
import com.graphhopper.routing.ev.SimpleBooleanEncodedValue;
import com.graphhopper.util.Helper;

import de.geofabrik.railway_routing.RailImportRegistry;
import de.geofabrik.railway_routing.RailwayHopper;

public final class StrictEnums {
    private StrictEnums() {}

    public enum StrictAccess {
        UNKNOWN, ALLOWED, RESTRICTED;
        public static final String KEY = "strict_access";
        public static EnumEncodedValue<StrictAccess> create() {
            return new EnumEncodedValue<>(KEY, StrictAccess.class);
        }
        @Override public String toString() { return Helper.toLowerCase(super.toString()); }
    }

    public enum StrictGaugeState {
        MISSING, KNOWN, INVALID;
        public static final String KEY = "strict_gauge_state";
        public static EnumEncodedValue<StrictGaugeState> create() {
            return new EnumEncodedValue<>(KEY, StrictGaugeState.class);
        }
        @Override public String toString() { return Helper.toLowerCase(super.toString()); }
    }

    public enum StrictElectrifiedState {
        UNKNOWN, YES, NO;
        public static final String KEY = "strict_electrified_state";
        public static EnumEncodedValue<StrictElectrifiedState> create() {
            return new EnumEncodedValue<>(KEY, StrictElectrifiedState.class);
        }
        @Override public String toString() { return Helper.toLowerCase(super.toString()); }
    }

    public enum StrictFreqState {
        MISSING, KNOWN_DC, KNOWN_AC, INVALID;
        public static final String KEY = "strict_freq_state";
        public static EnumEncodedValue<StrictFreqState> create() {
            return new EnumEncodedValue<>(KEY, StrictFreqState.class);
        }
        @Override public String toString() { return Helper.toLowerCase(super.toString()); }
    }

    public static final String KEY_STRICT_ACTIVE = "strict_active";
    public static final String KEY_STRICT_GAUGE_MM = "strict_gauge_mm";
    public static final String KEY_STRICT_VOLTAGE_KNOWN = "strict_voltage_known";
    public static final String KEY_STRICT_VOLTAGE_V = "strict_voltage_v";
    public static final String KEY_STRICT_FREQ_DHZ = "strict_freq_dhz";
    public static final String KEY_STRICT_MAXSPEED_KNOWN = "strict_maxspeed_known";
    public static final String KEY_STRICT_MAXSPEED_KMH = "strict_maxspeed_kmh";
    public static final String KEY_STRICT_ONEWAY_DIR = "strict_oneway_dir";

    public static final String STRICT_ENCODED_VALUES_STRING = String.join(",",
        "gauge", "voltage", "electrified", "frequency", "road_environment", "max_speed",
        "rail_access", "rail_average_speed", "railway_class", "railway_service",
        "preferred_direction", "osm_way_id",
        StrictAccess.KEY,
        KEY_STRICT_ACTIVE,
        StrictGaugeState.KEY,
        KEY_STRICT_GAUGE_MM,
        StrictElectrifiedState.KEY,
        KEY_STRICT_VOLTAGE_KNOWN,
        KEY_STRICT_VOLTAGE_V,
        StrictFreqState.KEY,
        KEY_STRICT_FREQ_DHZ,
        KEY_STRICT_MAXSPEED_KNOWN,
        KEY_STRICT_MAXSPEED_KMH,
        KEY_STRICT_ONEWAY_DIR
    );

    public static class StrictRailImportRegistry extends RailImportRegistry {
        @Override
        public ImportUnit createImportUnit(String name) {
            switch (name) {
                case StrictAccess.KEY:
                    return ImportUnit.create(name, props -> StrictAccess.create(),
                        (lookup, props) -> new StrictParsers.StrictAccessParser(
                            lookup.getEnumEncodedValue(StrictAccess.KEY, StrictAccess.class)));
                case KEY_STRICT_ACTIVE:
                    return ImportUnit.create(name, props -> new SimpleBooleanEncodedValue(KEY_STRICT_ACTIVE),
                        (lookup, props) -> new StrictParsers.StrictActiveParser(
                            lookup.getBooleanEncodedValue(KEY_STRICT_ACTIVE)));
                case StrictGaugeState.KEY:
                    return ImportUnit.create(name, props -> StrictGaugeState.create(),
                        (lookup, props) -> new StrictParsers.StrictGaugeStateParser(
                            lookup.getEnumEncodedValue(StrictGaugeState.KEY, StrictGaugeState.class),
                            lookup.getIntEncodedValue(KEY_STRICT_GAUGE_MM)),
                        KEY_STRICT_GAUGE_MM);
                case KEY_STRICT_GAUGE_MM:
                    return ImportUnit.create(name, props -> new IntEncodedValueImpl(KEY_STRICT_GAUGE_MM, 12, false),
                        (lookup, props) -> new StrictParsers.NoOpTagParser());
                case StrictElectrifiedState.KEY:
                    return ImportUnit.create(name, props -> StrictElectrifiedState.create(),
                        (lookup, props) -> new StrictParsers.StrictElectrifiedParser(
                            lookup.getEnumEncodedValue(StrictElectrifiedState.KEY, StrictElectrifiedState.class)));
                case KEY_STRICT_VOLTAGE_KNOWN:
                    return ImportUnit.create(name, props -> new SimpleBooleanEncodedValue(KEY_STRICT_VOLTAGE_KNOWN),
                        (lookup, props) -> new StrictParsers.StrictVoltageParser(
                            lookup.getBooleanEncodedValue(KEY_STRICT_VOLTAGE_KNOWN),
                            lookup.getIntEncodedValue(KEY_STRICT_VOLTAGE_V)),
                        KEY_STRICT_VOLTAGE_V);
                case KEY_STRICT_VOLTAGE_V:
                    return ImportUnit.create(name, props -> new IntEncodedValueImpl(KEY_STRICT_VOLTAGE_V, 16, false),
                        (lookup, props) -> new StrictParsers.NoOpTagParser());
                case StrictFreqState.KEY:
                    return ImportUnit.create(name, props -> StrictFreqState.create(),
                        (lookup, props) -> new StrictParsers.StrictFreqParser(
                            lookup.getEnumEncodedValue(StrictFreqState.KEY, StrictFreqState.class),
                            lookup.getIntEncodedValue(KEY_STRICT_FREQ_DHZ)),
                        KEY_STRICT_FREQ_DHZ);
                case KEY_STRICT_FREQ_DHZ:
                    return ImportUnit.create(name, props -> new IntEncodedValueImpl(KEY_STRICT_FREQ_DHZ, 16, false),
                        (lookup, props) -> new StrictParsers.NoOpTagParser());
                case KEY_STRICT_MAXSPEED_KNOWN:
                    return ImportUnit.create(name, props -> new SimpleBooleanEncodedValue(KEY_STRICT_MAXSPEED_KNOWN),
                        (lookup, props) -> new StrictParsers.StrictMaxSpeedParser(
                            lookup.getBooleanEncodedValue(KEY_STRICT_MAXSPEED_KNOWN),
                            lookup.getIntEncodedValue(KEY_STRICT_MAXSPEED_KMH)),
                        KEY_STRICT_MAXSPEED_KMH);
                case KEY_STRICT_MAXSPEED_KMH:
                    return ImportUnit.create(name, props -> new IntEncodedValueImpl(KEY_STRICT_MAXSPEED_KMH, 10, false),
                        (lookup, props) -> new StrictParsers.NoOpTagParser());
                case KEY_STRICT_ONEWAY_DIR:
                    return ImportUnit.create(name, props -> new SimpleBooleanEncodedValue(KEY_STRICT_ONEWAY_DIR, true),
                        (lookup, props) -> new StrictParsers.StrictOnewayParser(
                            lookup.getBooleanEncodedValue(KEY_STRICT_ONEWAY_DIR)));
                default:
                    return super.createImportUnit(name);
            }
        }
    }

    public static class StrictRailwayHopper extends RailwayHopper {
        public StrictRailwayHopper() {
            super();
            setImportRegistry(new StrictRailImportRegistry());
        }
    }
}
