use std::collections::HashMap;

use rapier3d::prelude::*;

use crate::math::{normalized, vector};
use crate::model::{DifferentialConfig, GearConfig};

#[derive(Clone)]
pub struct GearRuntime {
    pub body_a: RigidBodyHandle,
    pub body_b: RigidBodyHandle,
    pub local_axis_a: Vector,
    pub local_axis_b: Vector,
    pub local_center_a: Vector,
    pub local_center_b: Vector,
    pub teeth_a: Real,
    pub signed_teeth_b: Real,
    pub angle_a: Real,
    pub angle_b: Real,
    pub target_phase: Real,
}

#[derive(Clone)]
pub struct DifferentialRuntime {
    pub carrier: RigidBodyHandle,
    pub left: RigidBodyHandle,
    pub right: RigidBodyHandle,
    pub local_axis_carrier: Vector,
    pub local_axis_left: Vector,
    pub local_axis_right: Vector,
}

pub fn build_gears(
    configs: &[GearConfig],
    bodies: &HashMap<u32, RigidBodyHandle>,
    world: &PhysicsWorld,
) -> Vec<GearRuntime> {
    configs
        .iter()
        .filter_map(|config| {
            let body_a = *bodies.get(&config.body_a)?;
            let body_b = *bodies.get(&config.body_b)?;
            if body_a == body_b {
                return None;
            }
            let rigid_a = world.bodies.get(body_a)?;
            let rigid_b = world.bodies.get(body_b)?;
            Some(GearRuntime {
                body_a,
                body_b,
                local_axis_a: rigid_a
                    .position()
                    .inverse_transform_vector(normalized(config.axis_a)),
                local_axis_b: rigid_b
                    .position()
                    .inverse_transform_vector(normalized(config.axis_b)),
                local_center_a: rigid_a
                    .position()
                    .inverse_transform_point(vector(config.center_a)),
                local_center_b: rigid_b
                    .position()
                    .inverse_transform_point(vector(config.center_b)),
                teeth_a: config.teeth_a.max(1.0),
                signed_teeth_b: config.sign_b * config.teeth_b.max(1.0),
                angle_a: 0.0,
                angle_b: 0.0,
                target_phase: 0.0,
            })
        })
        .collect()
}

pub fn build_differentials(
    configs: &[DifferentialConfig],
    bodies: &HashMap<u32, RigidBodyHandle>,
    world: &PhysicsWorld,
) -> Vec<DifferentialRuntime> {
    configs
        .iter()
        .filter_map(|config| {
            let carrier = *bodies.get(&config.carrier)?;
            let left = *bodies.get(&config.left)?;
            let right = *bodies.get(&config.right)?;
            if carrier == left || carrier == right || left == right {
                return None;
            }
            Some(DifferentialRuntime {
                carrier,
                left,
                right,
                local_axis_carrier: world.bodies[carrier]
                    .position()
                    .inverse_transform_vector(normalized(config.axis_carrier)),
                local_axis_left: world.bodies[left]
                    .position()
                    .inverse_transform_vector(normalized(config.axis_left)),
                local_axis_right: world.bodies[right]
                    .position()
                    .inverse_transform_vector(normalized(config.axis_right)),
            })
        })
        .collect()
}

/// Projects angular velocity onto the exact tooth ratios. Forward and reverse
/// sweeps remove array-order bias so a long train transmits from either end.
pub fn project_velocities(
    gears: &[GearRuntime],
    differentials: &[DifferentialRuntime],
    world: &mut PhysicsWorld,
) {
    for _ in 0..16 {
        for gear in gears {
            solve_gear_velocity(gear, world);
        }
        for gear in gears.iter().rev() {
            solve_gear_velocity(gear, world);
        }
        for differential in differentials {
            solve_differential_velocity(differential, world);
        }
    }
}

fn solve_gear_velocity(gear: &GearRuntime, world: &mut PhysicsWorld) {
    let Some(body_a) = world.bodies.get(gear.body_a) else {
        return;
    };
    let Some(body_b) = world.bodies.get(gear.body_b) else {
        return;
    };
    let axis_a = body_a.rotation() * gear.local_axis_a;
    let axis_b = body_b.rotation() * gear.local_axis_b;
    let angular_a = body_a.angvel();
    let angular_b = body_b.angvel();
    let fixed_a = body_a.is_fixed();
    let fixed_b = body_b.is_fixed();
    if fixed_a && fixed_b {
        return;
    }

    let velocity_a = angular_a.dot(axis_a);
    let velocity_b = angular_b.dot(axis_b);
    let error = gear.teeth_a * velocity_a + gear.signed_teeth_b * velocity_b;
    if error.abs() < 1.0e-6 {
        return;
    }

    let (delta_a, delta_b) = if fixed_a {
        (0.0, -error / gear.signed_teeth_b)
    } else if fixed_b {
        (-error / gear.teeth_a, 0.0)
    } else {
        let denominator = gear.teeth_a * gear.teeth_a + gear.signed_teeth_b * gear.signed_teeth_b;
        (
            -error * gear.teeth_a / denominator,
            -error * gear.signed_teeth_b / denominator,
        )
    };

    if !fixed_a {
        world.bodies[gear.body_a].set_angvel(angular_a + axis_a * delta_a, true);
    }
    if !fixed_b {
        world.bodies[gear.body_b].set_angvel(angular_b + axis_b * delta_b, true);
    }
}

fn solve_differential_velocity(differential: &DifferentialRuntime, world: &mut PhysicsWorld) {
    let samples = [
        (differential.carrier, differential.local_axis_carrier, -2.0),
        (differential.left, differential.local_axis_left, 1.0),
        (differential.right, differential.local_axis_right, 1.0),
    ]
    .map(|(handle, local_axis, gradient)| {
        let body = &world.bodies[handle];
        let axis = body.rotation() * local_axis;
        (
            handle,
            axis,
            body.angvel(),
            body.angvel().dot(axis),
            gradient,
            body.is_fixed(),
        )
    });
    let error: Real = samples.iter().map(|sample| sample.3 * sample.4).sum();
    let denominator: Real = samples
        .iter()
        .filter(|sample| !sample.5)
        .map(|sample| sample.4 * sample.4)
        .sum();
    if error.abs() < 1.0e-6 || denominator < 1.0e-9 {
        return;
    }
    for (handle, axis, angular, _, gradient, fixed) in samples {
        if !fixed {
            let correction = -error * gradient / denominator;
            world.bodies[handle].set_angvel(angular + axis * correction, true);
        }
    }
}

/// Accumulates the angle that Rapier actually produced during the frame.
pub fn accumulate_angles(
    gears: &mut [GearRuntime],
    previous_rotations: &mut HashMap<RigidBodyHandle, Rotation>,
    world: &PhysicsWorld,
) {
    let mut deltas = HashMap::new();
    for gear in gears.iter() {
        for handle in [gear.body_a, gear.body_b] {
            if deltas.contains_key(&handle) {
                continue;
            }
            let current = *world.bodies[handle].rotation();
            let previous = previous_rotations
                .insert(handle, current)
                .unwrap_or(current);
            let delta = current * previous.inverse();
            deltas.insert(handle, delta.to_scaled_axis());
        }
    }

    for gear in gears {
        let axis_a = world.bodies[gear.body_a].rotation() * gear.local_axis_a;
        let axis_b = world.bodies[gear.body_b].rotation() * gear.local_axis_b;
        gear.angle_a += deltas
            .get(&gear.body_a)
            .map_or(0.0, |delta| delta.dot(axis_a));
        gear.angle_b += deltas
            .get(&gear.body_b)
            .map_or(0.0, |delta| delta.dot(axis_b));
    }
}

/// Hard tooth-phase projection. It executes wholly inside Rust after all
/// Rapier substeps, so no JavaScript call can alias a borrowed body set.
pub fn enforce_phase(gears: &mut [GearRuntime], world: &mut PhysicsWorld) {
    for _ in 0..6 {
        for index in 0..gears.len() {
            solve_phase(index, gears, world);
        }
        for index in (0..gears.len()).rev() {
            solve_phase(index, gears, world);
        }
    }
}

fn solve_phase(index: usize, gears: &mut [GearRuntime], world: &mut PhysicsWorld) {
    let gear = gears[index].clone();
    let error =
        gear.teeth_a * gear.angle_a + gear.signed_teeth_b * gear.angle_b - gear.target_phase;
    if error.abs() < 1.0e-6 {
        return;
    }
    let fixed_a = world.bodies[gear.body_a].is_fixed();
    let fixed_b = world.bodies[gear.body_b].is_fixed();
    if fixed_a && fixed_b {
        return;
    }

    let (correction_a, correction_b) = if fixed_a {
        (0.0, -error / gear.signed_teeth_b)
    } else if fixed_b {
        (-error / gear.teeth_a, 0.0)
    } else {
        let denominator = gear.teeth_a * gear.teeth_a + gear.signed_teeth_b * gear.signed_teeth_b;
        (
            -error * gear.teeth_a / denominator,
            -error * gear.signed_teeth_b / denominator,
        )
    };

    if correction_a.abs() > 1.0e-8 {
        rotate_body(
            gear.body_a,
            gear.local_axis_a,
            gear.local_center_a,
            correction_a,
            gears,
            world,
        );
    }
    if correction_b.abs() > 1.0e-8 {
        rotate_body(
            gear.body_b,
            gear.local_axis_b,
            gear.local_center_b,
            correction_b,
            gears,
            world,
        );
    }
}

fn rotate_body(
    handle: RigidBodyHandle,
    local_axis: Vector,
    local_center: Vector,
    angle: Real,
    gears: &mut [GearRuntime],
    world: &mut PhysicsWorld,
) {
    if world.bodies[handle].is_fixed() {
        return;
    }
    let current = *world.bodies[handle].position();
    let world_axis = current.rotation * local_axis;
    let world_center = current.transform_point(local_center);
    let delta = Rotation::from_axis_angle(world_axis.normalize(), angle);
    let translation = world_center + delta * (current.translation - world_center);
    let next = Pose::from_parts(translation, delta * current.rotation);
    world.bodies[handle].set_position(next, true);

    // One rigid body may contain several fixed gears. Reflect the exact body
    // rotation in every phase coordinate belonging to that body.
    for gear in gears {
        if gear.body_a == handle {
            let axis = world.bodies[handle].rotation() * gear.local_axis_a;
            gear.angle_a += angle * world_axis.dot(axis);
        }
        if gear.body_b == handle {
            let axis = world.bodies[handle].rotation() * gear.local_axis_b;
            gear.angle_b += angle * world_axis.dot(axis);
        }
    }
}
