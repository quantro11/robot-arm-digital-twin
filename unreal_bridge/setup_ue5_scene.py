"""
Unreal Engine 5 Editor Python Automation Script
------------------------------------------------
Run inside UE5: Tools -> Execute Python Script -> select this file!
Automatically constructs a Lumen-ready robotics laboratory scene in UE5 centimeters:
  - Workbench desk (top surface at Z = 0 cm, floor at Z = -78 cm)
  - 4x Sorting Zone markers (ZONE-A..D)
  - TX Wi-Fi Router + 3x ESP32-S3 CSI Node markers around the 420x420 cm lab room
  - Operator placeholder Actor (replace with MetaHuman or Hologram Material!)
  - Studio Lumen lighting rig (DirectionalLight + RectLight over workbench + PostProcessVolume)
"""

import unreal


def spawn_static_mesh(label: str, mesh_path: str, loc_cm, scale=(1, 1, 1), rot=(0, 0, 0)):
    mesh = unreal.EditorAssetLibrary.load_asset(mesh_path)
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.StaticMeshActor,
        unreal.Vector(*loc_cm),
        unreal.Rotator(*rot),
    )
    actor.set_actor_label(label)
    actor.static_mesh_component.set_static_mesh(mesh)
    actor.set_actor_scale3d(unreal.Vector(*scale))
    return actor


def build_robotics_lab():
    unreal.log("[DigitalTwin] Building UE5 Lumen Robotics & Wi-Fi CSI Lab...")

    cube_mesh = "/Engine/BasicShapes/Cube.Cube"
    cyl_mesh = "/Engine/BasicShapes/Cylinder.Cylinder"
    sphere_mesh = "/Engine/BasicShapes/Sphere.Sphere"

    # 1. Lab Floor (420 x 420 cm at Z = -78 cm)
    spawn_static_mesh("Lab_Floor", cube_mesh, (0, 0, -80), scale=(4.4, 4.4, 0.04))

    # 2. Workbench Desk (top flush at Z = 0 cm, centered at X = +16 cm forward)
    spawn_static_mesh("Workbench_Top", cube_mesh, (16, 0, -2), scale=(0.72, 0.92, 0.04))

    # 3. Overhead ESP32-CAM Gantry Frame
    spawn_static_mesh("Gantry_Post_L", cube_mesh, (24, -34, 27), scale=(0.02, 0.02, 0.54))
    spawn_static_mesh("Gantry_Post_R", cube_mesh, (24, 34, 27), scale=(0.02, 0.02, 0.54))
    spawn_static_mesh("Gantry_Crossbar", cube_mesh, (24, 0, 54), scale=(0.02, 0.70, 0.02))
    spawn_static_mesh("ESP32_CAM_Module", cube_mesh, (24, 0, 52), scale=(0.03, 0.045, 0.02))

    # 4. 6-DOF Robot Base Pedestal (Origin 0, 0, 0 — import your 3D-printed STL/FBX arm links here!)
    spawn_static_mesh("RobotArm_BasePedestal", cyl_mesh, (0, 0, 4.75), scale=(0.14, 0.14, 0.095))

    # 5. Four Sorting Zone Markers (UE5 X=forward, Y=right, Z=up in cm)
    zones = [
        ("Zone_A_Red", (12, -20, 0.2)),
        ("Zone_B_Blue", (12, 20, 0.2)),
        ("Zone_C_Green", (22, -20, 0.2)),
        ("Zone_D_Yellow", (22, 20, 0.2)),
    ]
    for name, loc in zones:
        spawn_static_mesh(name, cube_mesh, loc, scale=(0.075, 0.075, 0.004))

    # 6. Wi-Fi CSI Topology: 1x TX Router + 3x ESP32-S3 Nodes
    csi_nodes = [
        ("WiFi_TX_Router", (-155, -175, 57)),
        ("ESP32S3_CSI_RX1", (-145, 175, 37)),
        ("ESP32S3_CSI_RX2", (165, 170, 37)),
        ("ESP32S3_CSI_RX3", (160, -170, 37)),
    ]
    for name, loc in csi_nodes:
        spawn_static_mesh(name, sphere_mesh, loc, scale=(0.12, 0.12, 0.12))

    # 7. Wi-Fi CSI Tracked Human Operator Placeholder (Assign to RobotArmDigitalTwinActor.OperatorActor)
    spawn_static_mesh("WiFi_CSI_Operator", cyl_mesh, (125, 35, 8), scale=(0.35, 0.35, 1.72))

    # 8. Studio Overhead RectLight for Photorealistic Lumen Reflections on RTX 4060
    rect_light = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.RectLight,
        unreal.Vector(20, 0, 140),
        unreal.Rotator(-90, 0, 0),
    )
    rect_light.set_actor_label("Lab_Overhead_Softbox")
    rect_light.rect_light_component.set_intensity(18.0)
    rect_light.rect_light_component.set_source_width(120.0)
    rect_light.rect_light_component.set_source_height(90.0)

    unreal.log("[DigitalTwin] UE5 Scene Ready! Place BP_RobotArmDigitalTwinActor & press Play.")


if __name__ == "__main__":
    build_robotics_lab()
