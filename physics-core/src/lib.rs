mod math;
mod model;
mod systems;

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use js_sys::Float32Array;
use rapier3d::prelude::*;
use wasm_bindgen::prelude::*;

use math::{clamp_length, pose, rotation_to_array, vector};
use model::{
    ColliderConfig, ColliderShape, GearConfig, JointConfig, PhysicsCommand, SceneConfig, StepStats,
};
use systems::{forces, gears, joints, stops};

const TRANSFORM_STRIDE: usize = 15;

fn js_error(message: impl ToString) -> JsValue {
    js_sys::Error::new(&message.to_string()).into()
}

fn pair_key(left: u64, right: u64) -> (u64, u64) {
    if left <= right {
        (left, right)
    } else {
        (right, left)
    }
}

fn editor_id(value: f64, label: &str) -> Result<u64, JsValue> {
    if !value.is_finite() || value < 0.0 {
        return Err(js_error(format!("Invalid {label}: {value}")));
    }
    // Piece ids created by older editor versions contain a fractional random
    // component. Store the exact IEEE-754 bit pattern in Rapier's user_data so
    // no rounding can merge two different pieces.
    Ok(value.to_bits())
}

struct ContactFilter {
    excluded: HashSet<(u64, u64)>,
    candidates: Mutex<HashSet<(u64, u64)>>,
}

impl Default for ContactFilter {
    fn default() -> Self {
        Self {
            excluded: HashSet::new(),
            candidates: Mutex::new(HashSet::new()),
        }
    }
}

impl PhysicsHooks for ContactFilter {
    fn filter_contact_pair(&self, context: &PairFilterContext) -> Option<SolverFlags> {
        let owner_a = context.colliders[context.collider1].user_data as u64;
        let owner_b = context.colliders[context.collider2].user_data as u64;
        if owner_a != 0 && owner_b != 0 && owner_a != owner_b {
            if let Ok(mut candidates) = self.candidates.lock() {
                candidates.insert(pair_key(owner_a, owner_b));
            }
        }
        if owner_a != 0 && owner_b != 0 && self.excluded.contains(&pair_key(owner_a, owner_b)) {
            None
        } else {
            Some(SolverFlags::COMPUTE_IMPULSES)
        }
    }
}

/// The only object exported to JavaScript. Rapier bodies, colliders and joints
/// never cross this boundary, preventing wasm-bindgen aliasing/ownership errors.
#[wasm_bindgen]
pub struct PhysicsEngine {
    world: PhysicsWorld,
    body_ids: HashMap<u32, RigidBodyHandle>,
    ordered_bodies: Vec<(u32, RigidBodyHandle)>,
    joints: Vec<joints::JointRuntime>,
    joint_ids: HashMap<String, usize>,
    gears: Vec<gears::GearRuntime>,
    differentials: Vec<gears::DifferentialRuntime>,
    axial_stops: Vec<stops::AxialStopRuntime>,
    previous_gear_rotations: HashMap<RigidBodyHandle, Rotation>,
    contact_filter: ContactFilter,
    settings: model::PhysicsSettings,
    transforms: Vec<f32>,
    stats: StepStats,
    elapsed_seconds: f32,
}

#[wasm_bindgen]
impl PhysicsEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(scene: JsValue) -> Result<PhysicsEngine, JsValue> {
        let config: SceneConfig = serde_wasm_bindgen::from_value(scene)
            .map_err(|error| js_error(format!("Invalid physics scene: {error}")))?;

        let mut world = PhysicsWorld::new();
        world.gravity = vector(config.gravity);
        world.integration_parameters.num_solver_iterations =
            config.settings.solver_iterations.max(1);
        world.integration_parameters.num_internal_pgs_iterations =
            config.settings.internal_pgs_iterations.max(1);
        world.integration_parameters.normalized_allowed_linear_error =
            config.settings.allowed_linear_error.max(1.0e-5);
        world.integration_parameters.max_ccd_substeps = config.settings.max_ccd_substeps;

        // Infinite-looking editor floor. Its collider remains finite but much
        // larger than every practical LEGO mechanism.
        let floor = ColliderBuilder::cuboid(5_000.0, 0.15, 5_000.0)
            .translation(Vector::new(0.0, -0.2, 0.0))
            .friction(0.9)
            .collision_groups(InteractionGroups::new(
                Group::GROUP_1,
                Group::GROUP_1 | Group::GROUP_2,
                InteractionTestMode::And,
            ))
            .build();
        world.colliders.insert(floor);

        let mut body_ids = HashMap::with_capacity(config.bodies.len());
        let mut ordered_bodies = Vec::with_capacity(config.bodies.len());
        for body in &config.bodies {
            let builder = if body.fixed {
                RigidBodyBuilder::fixed()
            } else {
                RigidBodyBuilder::dynamic()
                    .linear_damping(body.linear_damping)
                    .angular_damping(body.angular_damping)
                    .ccd_enabled(body.ccd)
                    .soft_ccd_prediction(if config.settings.large_simulation {
                        0.0
                    } else {
                        0.1
                    })
                    .additional_solver_iterations(body.additional_solver_iterations)
                    .additional_mass(body.mass.max(0.01))
            }
            .pose(pose(body.position, body.rotation))
            .user_data(body.id as u128);
            let handle = world.bodies.insert(builder);
            body_ids.insert(body.id, handle);
            ordered_bodies.push((body.id, handle));

            for collider in &body.colliders {
                let collider = build_collider(collider)?;
                world
                    .colliders
                    .insert_with_parent(collider, handle, &mut world.bodies);
            }
        }
        ordered_bodies.sort_unstable_by_key(|entry| entry.0);

        let mut contact_filter = ContactFilter::default();
        for [left, right] in config.excluded_collider_pairs {
            contact_filter.excluded.insert(pair_key(
                editor_id(left, "excluded collider owner id")?,
                editor_id(right, "excluded collider owner id")?,
            ));
        }

        let mut runtime_joints = Vec::new();
        let mut joint_ids = HashMap::new();
        for joint in &config.joints {
            if let Some(runtime) = joints::create_joint(joint, &body_ids, &mut world) {
                joint_ids.insert(runtime.id.clone(), runtime_joints.len());
                runtime_joints.push(runtime);
            }
        }

        let runtime_gears = gears::build_gears(&config.gears, &body_ids, &world);
        let differentials = gears::build_differentials(&config.differentials, &body_ids, &world);
        let axial_stops = stops::build(&config.axial_stops, &body_ids, &world);
        let previous_gear_rotations = ordered_bodies
            .iter()
            .map(|(_, handle)| (*handle, *world.bodies[*handle].rotation()))
            .collect();
        let stats = StepStats {
            bodies: ordered_bodies.len(),
            active_bodies: ordered_bodies
                .iter()
                .filter(|(_, handle)| !world.bodies[*handle].is_fixed())
                .count(),
            sleeping_bodies: 0,
            joints: runtime_joints.len(),
            gears: runtime_gears.len(),
            substeps: if runtime_gears.is_empty() { 1 } else { 4 },
            max_spring_force: 0.0,
        };

        Ok(PhysicsEngine {
            world,
            body_ids,
            ordered_bodies,
            joints: runtime_joints,
            joint_ids,
            gears: runtime_gears,
            differentials,
            axial_stops,
            previous_gear_rotations,
            contact_filter,
            settings: config.settings,
            transforms: Vec::new(),
            stats,
            elapsed_seconds: 0.0,
        })
    }

    /// Advances motors, forces, constraints and Rapier as one Rust operation.
    /// The returned flat array contains 15 floats per body:
    /// id, position(3), quaternion(4), linear velocity(3), angular velocity(3), sleeping.
    pub fn step(&mut self, delta_seconds: f32, commands: JsValue) -> Result<Float32Array, JsValue> {
        let commands: Vec<PhysicsCommand> = serde_wasm_bindgen::from_value(commands)
            .map_err(|error| js_error(format!("Invalid physics commands: {error}")))?;
        let timestep = delta_seconds.clamp(1.0 / 240.0, 1.0 / 60.0);
        let substeps = if self.gears.is_empty() { 1 } else { 4 };

        self.stats.max_spring_force =
            forces::apply_commands(&commands, &self.body_ids, &mut self.world, timestep);
        joints::update_motors(&commands, &self.joint_ids, &self.joints, &mut self.world);
        joints::apply_axle_friction(&self.joints, &mut self.world, self.settings, timestep);

        self.world.integration_parameters.dt = timestep / substeps as f32;
        for _ in 0..substeps {
            gears::project_velocities(&self.gears, &self.differentials, &mut self.world);
            self.world.step_with_events(&self.contact_filter, &());
            gears::project_velocities(&self.gears, &self.differentials, &mut self.world);
        }
        gears::accumulate_angles(
            &mut self.gears,
            &mut self.previous_gear_rotations,
            &self.world,
        );
        gears::enforce_phase(&mut self.gears, &mut self.world);
        stops::enforce(&self.axial_stops, &mut self.world);
        self.elapsed_seconds += timestep;
        self.clamp_motion(self.elapsed_seconds < 0.35);
        self.collect_transforms();

        self.stats.substeps = substeps;
        self.stats.active_bodies = 0;
        self.stats.sleeping_bodies = 0;
        for (_, handle) in &self.ordered_bodies {
            let body = &self.world.bodies[*handle];
            if body.is_fixed() || body.is_sleeping() {
                self.stats.sleeping_bodies += 1;
            } else {
                self.stats.active_bodies += 1;
            }
        }

        Ok(Float32Array::from(self.transforms.as_slice()))
    }

    pub fn stats(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.stats)
            .map_err(|error| js_error(format!("Unable to serialize physics stats: {error}")))
    }

    pub fn transform_stride(&self) -> usize {
        TRANSFORM_STRIDE
    }

    pub fn set_excluded_collider_pairs(&mut self, pairs: JsValue) -> Result<(), JsValue> {
        let pairs: Vec<[f64; 2]> = serde_wasm_bindgen::from_value(pairs)
            .map_err(|error| js_error(format!("Invalid collider exclusions: {error}")))?;
        self.contact_filter.excluded.clear();
        for [left, right] in pairs {
            self.contact_filter.excluded.insert(pair_key(
                editor_id(left, "excluded collider owner id")?,
                editor_id(right, "excluded collider owner id")?,
            ));
        }
        Ok(())
    }

    /// Returns and clears collider-owner pairs observed since the last call.
    /// TypeScript uses this topology-only information to discover axle entries;
    /// all contact solving remains in Rust.
    pub fn take_contact_pairs(&mut self) -> Result<JsValue, JsValue> {
        let mut candidates = self
            .contact_filter
            .candidates
            .lock()
            .map_err(|_| js_error("Contact candidate lock was poisoned"))?;
        // Return numbers instead of BigInt: editor IDs stay below JS's exact
        // integer limit, and all existing TypeScript maps use `number` keys.
        let pairs: Vec<[f64; 2]> = candidates
            .drain()
            .map(|(left, right)| [f64::from_bits(left), f64::from_bits(right)])
            .collect();
        serde_wasm_bindgen::to_value(&pairs)
            .map_err(|error| js_error(format!("Unable to serialize contacts: {error}")))
    }

    pub fn replace_gears(&mut self, gears: JsValue) -> Result<(), JsValue> {
        let configs: Vec<GearConfig> = serde_wasm_bindgen::from_value(gears)
            .map_err(|error| js_error(format!("Invalid gear graph: {error}")))?;
        self.gears = systems::gears::build_gears(&configs, &self.body_ids, &self.world);
        self.previous_gear_rotations = self
            .ordered_bodies
            .iter()
            .map(|(_, handle)| (*handle, *self.world.bodies[*handle].rotation()))
            .collect();
        self.stats.gears = self.gears.len();
        Ok(())
    }

    pub fn add_joint(&mut self, joint: JsValue) -> Result<bool, JsValue> {
        let config: JointConfig = serde_wasm_bindgen::from_value(joint)
            .map_err(|error| js_error(format!("Invalid joint: {error}")))?;
        let Some(runtime) = systems::joints::create_joint(&config, &self.body_ids, &mut self.world)
        else {
            return Ok(false);
        };
        self.joint_ids.insert(runtime.id.clone(), self.joints.len());
        self.joints.push(runtime);
        self.stats.joints = self.joints.len();
        Ok(true)
    }

    pub fn remove_joint(&mut self, id: String) -> bool {
        let Some(index) = self.joint_ids.remove(&id) else {
            return false;
        };
        let runtime = self.joints.swap_remove(index);
        self.world.impulse_joints.remove(runtime.handle, true);
        if let Some(swapped) = self.joints.get(index) {
            self.joint_ids.insert(swapped.id.clone(), index);
        }
        self.stats.joints = self.joints.len();
        true
    }
}

impl PhysicsEngine {
    fn clamp_motion(&mut self, startup: bool) {
        let geared: HashSet<_> = self
            .gears
            .iter()
            .flat_map(|gear| [gear.body_a, gear.body_b])
            .collect();
        for (_, handle) in &self.ordered_bodies {
            let body = &mut self.world.bodies[*handle];
            if body.is_fixed() {
                continue;
            }
            let linear_limit = if startup { 2.0 } else { 12.0 };
            let angular_limit = if geared.contains(handle) {
                if startup { 20.0 } else { 80.0 }
            } else if startup {
                3.0
            } else {
                14.0
            };
            body.set_linvel(clamp_length(body.linvel(), linear_limit), true);
            body.set_angvel(clamp_length(body.angvel(), angular_limit), true);
        }
    }

    fn collect_transforms(&mut self) {
        self.transforms.clear();
        self.transforms
            .reserve(self.ordered_bodies.len() * TRANSFORM_STRIDE);
        for (id, handle) in &self.ordered_bodies {
            let body = &self.world.bodies[*handle];
            let position = body.translation();
            let rotation = rotation_to_array(body.rotation());
            let linear = body.linvel();
            let angular = body.angvel();
            self.transforms.extend_from_slice(&[
                *id as f32,
                position.x,
                position.y,
                position.z,
                rotation[0],
                rotation[1],
                rotation[2],
                rotation[3],
                linear.x,
                linear.y,
                linear.z,
                angular.x,
                angular.y,
                angular.z,
                if body.is_sleeping() { 1.0 } else { 0.0 },
            ]);
        }
    }
}

fn build_collider(config: &ColliderConfig) -> Result<Collider, JsValue> {
    let owner_id = editor_id(config.owner_id, "collider owner id")?;
    let builder = match &config.shape {
        ColliderShape::Box { half_extents } => {
            ColliderBuilder::cuboid(half_extents[0], half_extents[1], half_extents[2])
        }
        ColliderShape::Cylinder {
            half_height,
            radius,
        } => ColliderBuilder::cylinder((*half_height).max(0.01), (*radius).max(0.01)),
        ColliderShape::TriMesh { vertices, indices } => {
            let vertices = vertices
                .chunks_exact(3)
                .map(|value| Vector::new(value[0], value[1], value[2]))
                .collect();
            let indices = indices
                .chunks_exact(3)
                .map(|value| [value[0], value[1], value[2]])
                .collect();
            ColliderBuilder::trimesh_with_flags(
                vertices,
                indices,
                TriMeshFlags::FIX_INTERNAL_EDGES
                    | TriMeshFlags::MERGE_DUPLICATE_VERTICES
                    | TriMeshFlags::DELETE_DEGENERATE_TRIANGLES
                    | TriMeshFlags::DELETE_DUPLICATE_TRIANGLES,
            )
            .map_err(|error| js_error(format!("Invalid triangle collider: {error:?}")))?
        }
    };

    let memberships = Group::from_bits_retain(config.collision_group);
    let filter = Group::from_bits_retain(config.collision_mask);
    Ok(builder
        .position(pose(config.center, config.rotation))
        .friction(config.friction.max(0.0))
        .restitution(0.0)
        .density(config.density.max(0.0))
        .collision_groups(InteractionGroups::new(
            memberships,
            filter,
            InteractionTestMode::And,
        ))
        .active_hooks(ActiveHooks::FILTER_CONTACT_PAIRS)
        .user_data(owner_id as u128)
        .build())
}
