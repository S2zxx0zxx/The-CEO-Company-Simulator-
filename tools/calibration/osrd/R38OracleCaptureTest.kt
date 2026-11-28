/*
 * SPDX-License-Identifier: LGPL-3.0-only
 * Copyright © 2022 The OSRD Contributors (fixture setup adapted from
 * StandaloneSimulationTest.kt at the pinned revision).
 * R38 research-only integration test; never packaged in the game.
 */
package fr.sncf.osrd.standalone_sim

import fr.sncf.osrd.api.RangeValues
import fr.sncf.osrd.api.parseSpacingRequirements
import fr.sncf.osrd.api.standalone_sim.*
import fr.sncf.osrd.conflicts.*
import fr.sncf.osrd.envelope_sim.Comfort
import fr.sncf.osrd.path.implementations.buildTrainPathFromBlocks
import fr.sncf.osrd.pathfinding.constraints.ElectrificationConstraints
import fr.sncf.osrd.railjson.schema.infra.RJSInfra
import fr.sncf.osrd.railjson.schema.schedule.RJSAllowanceDistribution
import fr.sncf.osrd.railjson.schema.schedule.RJSTrainStop.RJSReceptionSignal.OPEN
import fr.sncf.osrd.train.TestTrains
import fr.sncf.osrd.utils.*
import fr.sncf.osrd.utils.units.*
import java.io.File
import kotlin.math.ceil
import org.junit.jupiter.api.Test
import kotlin.test.assertTrue
import kotlin.test.assertEquals

class R38OracleCaptureTest {
    @Test
    fun capture() {
        val out = File(System.getenv("R38_OUT") ?: error("R38_OUT required"))
        check(out.isDirectory)
        val fixture = Helpers.getExampleInfra("tiny_infra/infra.json")
        assertEquals("3.5.3", fixture.version)
        val infra = Helpers.tinyInfra
        val routes = listOf(
            "rt.buffer_stop_c->tde.track-bar",
            "rt.tde.track-bar->tde.switch_foo-track",
            "rt.tde.switch_foo-track->buffer_stop_a"
        ).map { infra.rawInfra.getRouteFromName(it) }
        val blocks = listOf(
            "[il.sig.C2-BAL];[buffer_stop_c, tde.track-bar];[]",
            "[il.sig.C2-BAL, il.sig.C6-BAL];[tde.track-bar, tde.switch_foo-track];[]",
            "[il.sig.C6-BAL];[tde.switch_foo-track, buffer_stop_a];[il.switch_foo-A_B2]"
        ).map { infra.blockInfra.getBlockFromName("block."+md5(it))!! }
        val path = buildTrainPathFromBlocks(infra.rawInfra, infra.blockInfra, blocks, listOf(), routes)
        val stock = TestTrains.REALISTIC_FAST_TRAIN
        val length = path.getLength().distance
        assertEquals(10400.0, length.meters)
        val electric = ElectrificationConstraints(infra.blockInfra, infra.rawInfra, TestTrains.FAST_ELECTRIC_TRAIN.modeNames)
        val blocked = blocks.any { electric.apply(it).isNotEmpty() }
        assertTrue(blocked, "pure electric on unelectrified tiny infra must not be allowed")
        out.resolve("compatibility.json").writeText("""{"electricBlocked":$blocked,"thermalSimulationRequired":true}""")
        for (dwell in listOf(0, 30)) {
            val schedule = (if (dwell == 0) emptyList() else listOf(
                SimulationScheduleItem(Offset(length / 2.0), null, StopDetails(dwell.seconds, OPEN, false))
            )) + SimulationScheduleItem(Offset(length), null, StopDetails(0.seconds, OPEN, false))
            val res = runStandaloneSimulation(
                infra, path, stock, Comfort.STANDARD, RJSAllowanceDistribution.LINEAR,
                null, offsetRangeMapOf(), false, true, 2.0, schedule, 0.0,
                RangeValues(listOf(), listOf())
            )
            val report = res.finalOutput
            assertTrue(report.times.size > 1)
            assertTrue(report.spacingRequirements.isNotEmpty())
            out.resolve("simulation-$dwell.json").writeText(simulationResponseAdapter.toJson(res))
            val spacing = parseSpacingRequirements(infra.rawInfra, report.spacingRequirements)
            assertTrue(spacing.all { it.endTime > it.beginTime })
            val actualS = report.times.last().seconds - report.times.first().seconds
            // Prespecified baseline and boundary probes, plus observed endpoint probe.
            // No assertion that a coarse game block equals a native signaling zone.
            val shifts = sortedSetOf(0, 1, 633, 634, 635, 674, 675, ceil(actualS).toInt(), ceil(actualS).toInt()+120)
            val original = Requirements(RequirementId("a", RequirementType.TRAIN), spacing, listOf())
            val rows = shifts.map { shift ->
                val shifted = spacing.map { it.copy(beginTime=it.beginTime+shift, endTime=it.endTime+shift) }
                val other = Requirements(RequirementId("b", RequirementType.TRAIN), shifted, listOf())
                val conflict = detectConflicts(listOf(original,other)).isNotEmpty()
                """{"shiftS":$shift,"osrdSpacingConflict":$conflict}"""
            }
            out.resolve("conflicts-$dwell.json").writeText("["+rows.joinToString(",")+"]")
        }
    }
}
