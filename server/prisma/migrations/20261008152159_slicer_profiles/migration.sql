-- Slicer profiles move from files in the worker image into the database, so officers can upload,
-- edit and delete them. The club's six approved presets come across as rows, queued for the
-- worker to flatten, and every plate is pointed at them by id.

-- CreateEnum
CREATE TYPE "SlicerProfileKind" AS ENUM ('PRINTER', 'PROCESS', 'FILAMENT');

-- CreateTable
CREATE TABLE "slicer_profiles" (
    "id" TEXT NOT NULL,
    "kind" "SlicerProfileKind" NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "offered" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "printer_id" TEXT,
    "source" TEXT NOT NULL,
    "source_file" TEXT NOT NULL,
    "state" "SlicerJobState" NOT NULL DEFAULT 'QUEUED',
    "failure" TEXT,
    "resolved" TEXT,
    "sha256" TEXT,
    "info" JSONB,
    "orca_version" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_token" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slicer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "slicer_profiles_kind_position_idx" ON "slicer_profiles"("kind", "position");

-- CreateIndex
CREATE INDEX "slicer_profiles_printer_id_position_idx" ON "slicer_profiles"("printer_id", "position");

-- CreateIndex
CREATE INDEX "slicer_profiles_state_requested_at_idx" ON "slicer_profiles"("state", "requested_at");

-- AddForeignKey
ALTER TABLE "slicer_profiles" ADD CONSTRAINT "slicer_profiles_printer_id_fkey" FOREIGN KEY ("printer_id") REFERENCES "slicer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slicer_profiles" ADD CONSTRAINT "slicer_profiles_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The presets that were in orca/profiles/, as exported from desktop Orca (orca/source/).
INSERT INTO "slicer_profiles" ("id", "kind", "name", "label", "description", "position", "printer_id", "source", "source_file", "updated_at")
VALUES ('95615e66-0df8-4a06-a912-1de4468a6eca', 'PRINTER', $p$CC1$p$, $p$CC1$p$, NULL, 0, NULL,
$p${
	"adaptive_bed_mesh_margin": "0",
	"auxiliary_fan": "1",
	"bbl_use_printhost": "0",
	"bed_custom_model": "",
	"bed_custom_texture": "",
	"bed_exclude_area": [
		"246x0",
		"256x0",
		"256x20",
		"246x20"
	],
	"bed_mesh_max": "99999,99999",
	"bed_mesh_min": "-99999,-99999",
	"bed_mesh_probe_distance": "50,50",
	"bed_temperature_formula": "by_highest_temp",
	"before_layer_change_gcode": ";BEFORE_LAYER_CHANGE\n;[layer_z]\nG92 E0\n",
	"best_object_pos": "0.5,0.5",
	"change_extrusion_role_gcode": "",
	"change_filament_gcode": "\n;==========CC_CHANGE_FILAMENT_GCODE_CCB==========\n;===== date: 2025-12-04-001 =====================\nM106 S0\nM106 P2 S0\nG1 Z{min(max_layer_z+3, printable_height+0.5)} F1200\nM6211 T[next_extruder] L[flush_length] M{old_filament_e_feedrate} N{new_filament_e_feedrate} Q[old_filament_temp] R[nozzle_temperature_range_high] S[new_filament_temp]\nT[next_extruder]\n;==========CC_CHANGE_FILAMENT_GCODE_CCE==========",
	"cooling_tube_length": "5",
	"cooling_tube_retraction": "90",
	"default_bed_type": "4",
	"default_filament_profile": [
		"Elegoo PLA @ECC"
	],
	"default_nozzle_volume_type": [
		"Standard"
	],
	"default_print_profile": "0.20mm Standard @Elegoo CC 0.4 nozzle",
	"deretraction_speed": [
		"30"
	],
	"disable_m73": "0",
	"emit_machine_limits_to_gcode": "1",
	"enable_filament_ramming": "0",
	"enable_long_retraction_when_cut": "0",
	"enable_power_loss_recovery": "printer_configuration",
	"extra_loading_move": "-2",
	"extruder_clearance_height_to_lid": "90",
	"extruder_clearance_height_to_rod": "36",
	"extruder_clearance_radius": "68",
	"extruder_colour": [
		"#018001"
	],
	"extruder_offset": [
		"0x0"
	],
	"extruder_printable_area": [],
	"extruder_printable_height": [
		"0"
	],
	"extruder_type": [
		"Direct Drive"
	],
	"extruder_variant_list": [
		"Direct Drive Standard"
	],
	"fan_kickstart": "0",
	"fan_speedup_overhangs": "1",
	"fan_speedup_time": "0.5",
	"file_start_gcode": "",
	"flashforge_serial_number": "",
	"from": "User",
	"gcode_flavor": "klipper",
	"grab_length": [
		"0"
	],
	"head_wrap_detect_zone": [],
	"high_current_on_filament_swap": "0",
	"host_type": "elegoolink",
	"inherits": "Elegoo Centauri Carbon 0.4 nozzle",
	"input_shaping_damp_x": "0.1",
	"input_shaping_damp_y": "0.1",
	"input_shaping_emit": "0",
	"input_shaping_freq_x": "0",
	"input_shaping_freq_y": "0",
	"input_shaping_type": "Default",
	"layer_change_gcode": ";LAYER:{layer_num+1}\nSET_PRINT_STATS_INFO CURRENT_LAYER={layer_num + 1}\n",
	"long_retractions_when_cut": [
		"0"
	],
	"machine_end_gcode": ";===== CC_END_GCODE ================\n;===== date: 2025-12-04-001 =====================\nM400 ; wait for buffer to clear\nM140 S0 ;Turn-off bed\nM106 S255 ;Cooling nozzle\nM83\nG92 E0 ; zero the extruder\nG1 E-0.8 F1800\nG2 I1 J0 Z{max_layer_z+0.5} F3000 ; lower z a little\nG90\n{if max_layer_z > 100}G1 Z{min(max_layer_z+50, printable_height+0.5)} F20000{else}G1 Z100 F20000 {endif}; Move print head up \nM204 S5000\nM749\nM204 S5000\nM400\nM83\nG1 X202 F20000\nM400\nG1 Y250 F20000\nG1 Y264.5 F1200\nM400\nG92 E0\nM104 S0 ;Turn-off hotend\nM140 S0 ;Turn-off bed\nM106 S0 ; turn off fan\nM106 P2 S0 ; turn off remote part cooling fan\nM106 P3 S0 ; turn off chamber cooling fan\nM84 ;Disable all steppers",
	"machine_load_filament_time": "29",
	"machine_max_acceleration_e": [
		"5000",
		"5000"
	],
	"machine_max_acceleration_extruding": [
		"20000",
		"20000"
	],
	"machine_max_acceleration_retracting": [
		"5000",
		"5000"
	],
	"machine_max_acceleration_travel": [
		"20000",
		"20000"
	],
	"machine_max_acceleration_x": [
		"20000",
		"20000"
	],
	"machine_max_acceleration_y": [
		"20000",
		"20000"
	],
	"machine_max_acceleration_z": [
		"500",
		"200"
	],
	"machine_max_jerk_e": [
		"2.5",
		"2.5"
	],
	"machine_max_jerk_x": [
		"9",
		"9"
	],
	"machine_max_jerk_y": [
		"9",
		"9"
	],
	"machine_max_jerk_z": [
		"3",
		"3"
	],
	"machine_max_junction_deviation": [
		"0.01"
	],
	"machine_max_speed_e": [
		"30",
		"30"
	],
	"machine_max_speed_x": [
		"500",
		"200"
	],
	"machine_max_speed_y": [
		"500",
		"200"
	],
	"machine_max_speed_z": [
		"20",
		"20"
	],
	"machine_min_extruding_rate": [
		"0",
		"0"
	],
	"machine_min_travel_rate": [
		"0",
		"0"
	],
	"machine_pause_gcode": "M600",
	"machine_start_gcode": ";;===== date: 20240520 =====================\n;printer_model:[printer_model]\n;initial_filament:{filament_type[initial_extruder]}\n;curr_bed_type:{curr_bed_type}\nM400 ; wait for buffer to clear\nM220 S100 ;Set the feed speed to 100%\nM221 S100 ;Set the flow rate to 100%\nM104 S140\nM190 S[bed_temperature_initial_layer_single]\nG90\nG28 ;home\nM729 ;Clean Nozzle\n\n\n;=============turn on fans to prevent PLA jamming=================\n{if filament_type[initial_no_support_extruder]==\"PLA\"}\n    {if (bed_temperature[initial_no_support_extruder] >50)||(bed_temperature_initial_layer[initial_no_support_extruder] >50)}\n    M106 P3 S255\n    {elsif (bed_temperature[initial_no_support_extruder] >45)||(bed_temperature_initial_layer[initial_no_support_extruder] >45)}\n    M106 P3 S180\n    {endif};Prevent PLA from jamming\n{endif}\n\n;enable_pressure_advance:{enable_pressure_advance[initial_extruder]}\n;This value is called if pressure advance is enabled\n{if enable_pressure_advance[initial_extruder] == \"true\"}\nSET_PRESSURE_ADVANCE ADVANCE=[pressure_advance] ;\nM400\n{endif}\nM204 S{min(20000,max(1000,outer_wall_acceleration))} ;Call exterior wall print acceleration\n\n\nG1 X{print_bed_max[0]*0.5} Y-1.2 F20000\nG1 Z0.3 F900\nM109 S[nozzle_temperature_initial_layer]\nM83\nG92 E0 ;Reset Extruder\nG1 F{min(6000, max(900, filament_max_volumetric_speed[initial_no_support_extruder]/0.5/0.3*60))} \nG1 X-1.2 E10.156 ;Draw the first line\nG1 Y98.8 E7.934\nG1 X-0.5 Y100 E0.1\nG1 Y-0.3 E7.934\nG1 X{print_bed_max[0]*0.5-50} E6.284\nG1 F{0.2*min(12000, max(1200, filament_max_volumetric_speed[initial_no_support_extruder]/0.5/0.3*60))} \nG1 X{print_bed_max[0]*0.5-30} E2\nG1 F{min(12000, max(1200, filament_max_volumetric_speed[initial_no_support_extruder]/0.5/0.3*60))} \nG1 X{print_bed_max[0]*0.5-10} E2\nG1 F{0.2*min(12000, max(1200, filament_max_volumetric_speed[initial_no_support_extruder]/0.5/0.3*60))} \nG1 X{print_bed_max[0]*0.5+10} E2\nG1 F{min(12000, max(1200, filament_max_volumetric_speed[initial_no_support_extruder]/0.5/0.3*60))} \nG1 X{print_bed_max[0]*0.5+30} E2\nG1 F{min(12000, max(1200, filament_max_volumetric_speed[initial_no_support_extruder]/0.5/0.3*60))} \nG1 X{print_bed_max[0]*0.5+50} E2\n;End PA test.\n\n\nG3 I-1 J0 Z0.6 F1200.0 ;Move to side a little\nG1 F20000\nG92 E0 ;Reset Extruder\n;LAYER_COUNT:[total_layer_count]\n;LAYER:0\nSET_PRINT_STATS_INFO TOTAL_LAYER=[total_layer_count]",
	"machine_tool_change_time": "0",
	"machine_unload_filament_time": "28",
	"manual_filament_change": "0",
	"master_extruder_id": "1",
	"max_layer_height": [
		"0.28"
	],
	"max_resonance_avoidance_speed": "120",
	"min_layer_height": [
		"0.08"
	],
	"min_resonance_avoidance_speed": "70",
	"name": "CC1",
	"nozzle_diameter": [
		"0.4"
	],
	"nozzle_flush_dataset": [
		"0"
	],
	"nozzle_height": "2.5",
	"nozzle_hrc": "0",
	"nozzle_type": [
		"hardened_steel"
	],
	"nozzle_volume": [
		"107"
	],
	"parallel_printheads_bed_exclude_areas": [],
	"parallel_printheads_count": "1",
	"parking_pos_retraction": "90",
	"part_cooling_fan_min_pwm": "0",
	"pellet_modded_printer": "0",
	"physical_extruder_map": [
		"0"
	],
	"preferred_orientation": "0",
	"printable_area": [
		"0x0",
		"256x0",
		"256x256",
		"0x256"
	],
	"printable_height": "256",
	"printer_agent": "",
	"printer_extruder_id": [
		"1"
	],
	"printer_extruder_variant": [
		"Direct Drive Standard"
	],
	"printer_model": "Elegoo Centauri Carbon",
	"printer_notes": "",
	"printer_settings_id": "CC1",
	"printer_structure": "corexy",
	"printer_technology": "FFF",
	"printer_variant": "0.4",
	"printhost_authorization_type": "key",
	"printhost_ssl_ignore_revoke": "0",
	"printing_by_object_gcode": "",
	"purge_in_prime_tower": "0",
	"resonance_avoidance": "0",
	"retract_before_wipe": [
		"0%"
	],
	"retract_length_toolchange": [
		"0"
	],
	"retract_lift_above": [
		"0"
	],
	"retract_lift_below": [
		"255"
	],
	"retract_lift_enforce": [
		"All Surfaces"
	],
	"retract_restart_extra": [
		"0"
	],
	"retract_restart_extra_toolchange": [
		"0"
	],
	"retract_when_changing_layer": [
		"1"
	],
	"retraction_distances_when_cut": [
		"18"
	],
	"retraction_length": [
		"0.8"
	],
	"retraction_minimum_travel": [
		"0.8"
	],
	"retraction_speed": [
		"30"
	],
	"scan_first_layer": "1",
	"silent_mode": "0",
	"single_extruder_multi_material": "1",
	"support_air_filtration": "1",
	"support_chamber_temp_control": "0",
	"support_multi_bed_types": "1",
	"support_object_skip_flush": "0",
	"support_parallel_printheads": "0",
	"template_custom_gcode": "",
	"thumbnails": "144x144/PNG",
	"thumbnails_format": "PNG",
	"time_cost": "0",
	"time_lapse_gcode": "",
	"tool_change_on_wipe_tower": "0",
	"travel_slope": [
		"3"
	],
	"upward_compatible_machine": [],
	"use_3mf": "0",
	"use_firmware_retraction": "0",
	"use_relative_e_distances": "1",
	"version": "2.3.0.3",
	"wipe": [
		"1"
	],
	"wipe_distance": [
		"1.2"
	],
	"wipe_tower_type": "type2",
	"wrapping_detection_gcode": "",
	"wrapping_detection_layers": "20",
	"wrapping_exclude_area": [],
	"z_hop": [
		"0.4"
	],
	"z_hop_types": [
		"Auto Lift"
	],
	"z_offset": "0"
}
$p$, $p$CC1.orca_printer: printer/CC1.json$p$, CURRENT_TIMESTAMP);

INSERT INTO "slicer_profiles" ("id", "kind", "name", "label", "description", "position", "printer_id", "source", "source_file", "updated_at")
VALUES ('60e66dee-17e7-4f2e-8bd3-3fefcea86d5d', 'PROCESS', $p$0.20mm, 0.4 nozzle, Line, T-Support$p$, $p$Standard$p$, NULL, 0, '95615e66-0df8-4a06-a912-1de4468a6eca',
$p${
    "brim_type": "no_brim",
    "enable_support": "1",
    "from": "User",
    "inherits": "0.20mm Standard @Elegoo CC 0.4 nozzle",
    "is_custom_defined": "0",
    "name": "0.20mm, 0.4 nozzle, Line, T-Support",
    "print_settings_id": "0.20mm, 0.4 nozzle, Line, T-Support",
    "sparse_infill_pattern": "line",
    "support_type": "tree(auto)",
    "version": "2.3.0.3"
}
$p$, $p$CC1.orca_printer: process/0.20mm, 0.4 nozzle, Line, T-Support.json$p$, CURRENT_TIMESTAMP);

INSERT INTO "slicer_profiles" ("id", "kind", "name", "label", "description", "position", "printer_id", "source", "source_file", "updated_at")
VALUES ('7cebbd83-c13f-4082-a934-585485ea6836', 'PROCESS', $p$0.20mm, Q, 0.4 nozzle, Line, T-Support$p$, $p$Q$p$, NULL, 1, '95615e66-0df8-4a06-a912-1de4468a6eca',
$p${
	"brim_type": "no_brim",
	"enable_support": "1",
	"from": "User",
	"inherits": "0.20mm Standard @Elegoo CC 0.4 nozzle",
	"name": "0.20mm, Q, 0.4 nozzle, Line, T-Support",
	"outer_wall_line_width": "0.6",
	"outer_wall_speed": "100",
	"print_extruder_id": [
		"1"
	],
	"print_extruder_variant": [
		"Direct Drive Standard"
	],
	"print_settings_id": "0.20mm, Q, 0.4 nozzle, Line, T-Support",
	"seam_gap": "0",
	"seam_slope_type": "external",
	"sparse_infill_density": "10%",
	"sparse_infill_pattern": "gyroid",
	"support_type": "tree(auto)",
	"version": "2.3.0.3",
	"wall_loops": "3",
	"wall_sequence": "inner-outer-inner wall"
}
$p$, $p$CC1.orca_printer: process/0.20mm, Q, 0.4 nozzle, Line, T-Support.json$p$, CURRENT_TIMESTAMP);

INSERT INTO "slicer_profiles" ("id", "kind", "name", "label", "description", "position", "printer_id", "source", "source_file", "updated_at")
VALUES ('c989c3aa-11fb-4904-8602-d0bf44cb4326', 'PROCESS', $p$0.20mm, Q-S, 0.4 nozzle, Line, T-Support$p$, $p$Q-S$p$, NULL, 2, '95615e66-0df8-4a06-a912-1de4468a6eca',
$p${
    "brim_type": "no_brim",
    "enable_support": "1",
    "from": "User",
    "inherits": "0.20mm Standard @Elegoo CC 0.4 nozzle",
    "is_custom_defined": "0",
    "name": "0.20mm, Q-S, 0.4 nozzle, Line, T-Support",
    "outer_wall_line_width": "0.6",
    "outer_wall_speed": "100",
    "print_settings_id": "0.20mm, Q-S, 0.4 nozzle, Line, T-Support",
    "seam_gap": "0",
    "seam_slope_type": "external",
    "sparse_infill_density": "6%",
    "sparse_infill_pattern": "3dhoneycomb",
    "support_type": "tree(auto)",
    "version": "2.3.0.3",
    "wall_loops": "6",
    "wall_sequence": "inner-outer-inner wall"
}
$p$, $p$CC1.orca_printer: process/0.20mm, Q-S, 0.4 nozzle, Line, T-Support.json$p$, CURRENT_TIMESTAMP);

INSERT INTO "slicer_profiles" ("id", "kind", "name", "label", "description", "position", "printer_id", "source", "source_file", "updated_at")
VALUES ('ae4862ac-5fc5-4f06-b30c-466d0bbccb4e', 'FILAMENT', $p$Elegoo Rapid PLA$p$, $p$PLA$p$, $p$Stiff, easy, and fine indoors. The default for a reason.$p$, 0, NULL,
$p${
    "compatible_printers": [],
    "complete_print_exhaust_fan_speed": [
        "70"
    ],
    "cool_plate_temp": [
        "35"
    ],
    "cool_plate_temp_initial_layer": [
        "35"
    ],
    "during_print_exhaust_fan_speed": [
        "70"
    ],
    "eng_plate_temp": [
        "0"
    ],
    "eng_plate_temp_initial_layer": [
        "0"
    ],
    "filament_end_gcode": [
        "; filament end gcode\n"
    ],
    "filament_flow_ratio": [
        "1"
    ],
    "filament_max_volumetric_speed": [
        "12"
    ],
    "filament_settings_id": [
        "Elegoo Rapid PLA"
    ],
    "filament_start_gcode": [
        "; Filament gcode\n"
    ],
    "from": "User",
    "inherits": "Elegoo Generic PLA",
    "is_custom_defined": "0",
    "name": "Elegoo Rapid PLA",
    "nozzle_temperature": [
        "200"
    ],
    "nozzle_temperature_initial_layer": [
        "205"
    ],
    "nozzle_temperature_range_high": [
        "205"
    ],
    "nozzle_temperature_range_low": [
        "200"
    ],
    "required_nozzle_HRC": [
        "3"
    ],
    "slow_down_layer_time": [
        "4"
    ],
    "temperature_vitrification": [
        "45"
    ],
    "textured_plate_temp": [
        "55"
    ],
    "textured_plate_temp_initial_layer": [
        "55"
    ],
    "version": "1.9.0.2"
}
$p$, $p$Generic PLA.orca_filament: System/Elegoo Rapid PLA.json$p$, CURRENT_TIMESTAMP);

INSERT INTO "slicer_profiles" ("id", "kind", "name", "label", "description", "position", "printer_id", "source", "source_file", "updated_at")
VALUES ('633e48cd-a6f7-4dbb-822f-7e077f661182', 'FILAMENT', $p$Elegoo RAPID PETG Optimized$p$, $p$PETG$p$, $p$Tougher and takes heat better, for outdoor and under-the-hood parts.$p$, 1, NULL,
$p${
    "enable_pressure_advance": [
        "1"
    ],
    "filament_cost": [
        "13.99"
    ],
    "filament_density": [
        "1.29"
    ],
    "filament_flow_ratio": [
        "0.99"
    ],
    "filament_max_volumetric_speed": [
        "28"
    ],
    "filament_retraction_length": [
        "0.25"
    ],
    "filament_settings_id": [
        "Elegoo RAPID PETG Optimized"
    ],
    "from": "User",
    "inherits": "Elegoo RAPID PETG @ECC",
    "is_custom_defined": "0",
    "name": "Elegoo RAPID PETG Optimized",
    "nozzle_temperature": [
        "240"
    ],
    "nozzle_temperature_initial_layer": [
        "240"
    ],
    "pressure_advance": [
        "0.06"
    ],
    "slow_down_layer_time": [
        "1"
    ],
    "version": "2.3.1.0"
}
$p$, $p$Elegoo Rapid PETG.orca_filament: ECC/Elegoo RAPID PETG Optimized.json$p$, CURRENT_TIMESTAMP);

-- AlterTable
ALTER TABLE "print_requests" ADD COLUMN     "filament_profile_id" TEXT,
ADD COLUMN     "printer_profile_id" TEXT,
ADD COLUMN     "process_profile_id" TEXT,
ADD COLUMN     "sliced_with" JSONB;

-- Every plate so far was sliced on the CC1, with one of the three presets and PLA or PETG.
UPDATE "print_requests" SET
  "printer_profile_id" = '95615e66-0df8-4a06-a912-1de4468a6eca',
  "process_profile_id" = CASE "preset"
    WHEN 'Q' THEN '7cebbd83-c13f-4082-a934-585485ea6836'
    WHEN 'QS' THEN 'c989c3aa-11fb-4904-8602-d0bf44cb4326'
    ELSE '60e66dee-17e7-4f2e-8bd3-3fefcea86d5d'
  END,
  "filament_profile_id" = CASE "material" WHEN 'PETG' THEN '633e48cd-a6f7-4dbb-822f-7e077f661182' ELSE 'ae4862ac-5fc5-4f06-b30c-466d0bbccb4e' END,
  "sliced_with" = jsonb_build_object(
    'printer', 'CC1',
    'process', CASE "preset" WHEN 'Q' THEN 'Q' WHEN 'QS' THEN 'Q-S' ELSE 'Standard' END,
    'filament', CASE "material" WHEN 'PETG' THEN 'PETG' ELSE 'PLA' END
  ),
  "material" = 'PLA'
WHERE "preset" IS NOT NULL;

ALTER TABLE "print_requests" DROP COLUMN "preset";

-- DropEnum
DROP TYPE "PrintPreset";

-- A job queued before this names its presets the old way, which the worker no longer reads.
UPDATE "print_slices" SET
  "state" = 'FAILED',
  "failure" = 'The slicer was updated. Slice again.',
  "retryable" = true,
  "lease_token" = NULL,
  "lease_expires_at" = NULL,
  "finished_at" = CURRENT_TIMESTAMP
WHERE "state" IN ('QUEUED', 'RUNNING');

-- AlterTable
ALTER TABLE "print_slices" DROP COLUMN "profile_set_hash";

-- AlterTable
ALTER TABLE "slicer_workers" DROP COLUMN "profile_set_hash";

-- AddForeignKey
ALTER TABLE "print_requests" ADD CONSTRAINT "print_requests_printer_profile_id_fkey" FOREIGN KEY ("printer_profile_id") REFERENCES "slicer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_requests" ADD CONSTRAINT "print_requests_process_profile_id_fkey" FOREIGN KEY ("process_profile_id") REFERENCES "slicer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_requests" ADD CONSTRAINT "print_requests_filament_profile_id_fkey" FOREIGN KEY ("filament_profile_id") REFERENCES "slicer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
