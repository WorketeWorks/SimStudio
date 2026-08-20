use std::collections::{HashMap, HashSet};

use rapier3d::prelude::*;

use crate::model::DifferentialConfig;

const EPSILON: Real = 1.0e-6;

#[derive(Clone)]
pub struct DifferentialRuntime {
    pub left: RigidBodyHandle,
    pub right: RigidBodyHandle,
    pub carrier: RigidBodyHandle,
    pub local_axis_left: Vector,
    pub local_axis_right: Vector,
    pub local_axis_carrier: Vector,
}

fn vector(value: [f32; 3]) -> Vector {
    Vector::new(value[0], value[1], value[2])
}

pub fn build(
    configs: &[DifferentialConfig],
    bodies: &HashMap<u32, RigidBodyHandle>,
    world: &PhysicsWorld,
) -> Vec<DifferentialRuntime> {
    configs.iter().filter_map(|config| {
        let left = *bodies.get(&config.left_body)?;
        let right = *bodies.get(&config.right_body)?;
        let carrier = *bodies.get(&config.carrier_body)?;
        if left == right || left == carrier || right == carrier { return None; }
        let mut axis = vector(config.axis);
        if axis.length_squared() <= EPSILON { return None; }
        axis = axis.normalize();
        let left_body = world.bodies.get(left)?;
        let right_body = world.bodies.get(right)?;
        let carrier_body = world.bodies.get(carrier)?;
        Some(DifferentialRuntime {
            left,
            right,
            carrier,
            local_axis_left: left_body.position().inverse_transform_vector(axis),
            local_axis_right: right_body.position().inverse_transform_vector(axis),
            local_axis_carrier: carrier_body.position().inverse_transform_vector(axis),
        })
    }).collect()
}

/// Enforces ω_left + ω_right = 2ω_carrier using one conservative angular
/// impulse. This naturally routes motion through whichever member is free.
pub fn project_velocities(
    differentials: &[DifferentialRuntime],
    driven_bodies: &HashSet<RigidBodyHandle>,
    world: &mut PhysicsWorld,
) {
    for differential in differentials {
        let (axis_l, axis_r, axis_c, wl, wr, wc, il, ir, ic, fixed_l, fixed_r, fixed_c) = {
            let Some(left) = world.bodies.get(differential.left) else { continue; };
            let Some(right) = world.bodies.get(differential.right) else { continue; };
            let Some(carrier) = world.bodies.get(differential.carrier) else { continue; };
            let axis_l = (left.position().rotation * differential.local_axis_left).normalize();
            let axis_r = (right.position().rotation * differential.local_axis_right).normalize();
            let axis_c = (carrier.position().rotation * differential.local_axis_carrier).normalize();
            (
                axis_l, axis_r, axis_c,
                left.angvel().dot(axis_l),
                right.angvel().dot(axis_r),
                carrier.angvel().dot(axis_c),
                axis_l.dot(left.mass_properties().effective_world_inv_inertia * axis_l),
                axis_r.dot(right.mass_properties().effective_world_inv_inertia * axis_r),
                axis_c.dot(carrier.mass_properties().effective_world_inv_inertia * axis_c),
                left.is_fixed(), right.is_fixed(), carrier.is_fixed(),
            )
        };
        let error = wl + wr - 2.0 * wc;
        let driven_l = driven_bodies.contains(&differential.left);
        let driven_r = driven_bodies.contains(&differential.right);
        let driven_c = driven_bodies.contains(&differential.carrier);

        // While the user or a command actively drives one differential member,
        // preserve that input and route the necessary motion through the free
        // members. An inertia-weighted impulse made the carrier feel extremely
        // heavy and consumed most of the drag torque before visible motion.
        if driven_l && !driven_r && !driven_c {
            if fixed_r && fixed_c {
                set_axis_speed(world, differential.left, axis_l, 0.0);
            } else if fixed_r {
                set_axis_speed(world, differential.carrier, axis_c, wl * 0.5);
            } else if fixed_c {
                set_axis_speed(world, differential.right, axis_r, -wl);
            } else {
                // Preserve the undriven side's current speed (including zero
                // when blocked) and send the remainder to the carrier.
                set_axis_speed(world, differential.carrier, axis_c, (wl + wr) * 0.5);
            }
            continue;
        }
        if driven_r && !driven_l && !driven_c {
            if fixed_l && fixed_c {
                set_axis_speed(world, differential.right, axis_r, 0.0);
            } else if fixed_l {
                set_axis_speed(world, differential.carrier, axis_c, wr * 0.5);
            } else if fixed_c {
                set_axis_speed(world, differential.left, axis_l, -wr);
            } else {
                set_axis_speed(world, differential.carrier, axis_c, (wl + wr) * 0.5);
            }
            continue;
        }
        if driven_c && !driven_l && !driven_r {
            if fixed_l && fixed_r {
                set_axis_speed(world, differential.carrier, axis_c, 0.0);
            } else if fixed_l {
                set_axis_speed(world, differential.right, axis_r, 2.0 * wc);
            } else if fixed_r {
                set_axis_speed(world, differential.left, axis_l, 2.0 * wc);
            } else {
                // Keep the existing left/right speed difference and correct
                // their mean to the carrier speed.
                let correction = wc - (wl + wr) * 0.5;
                set_axis_speed(world, differential.left, axis_l, wl + correction);
                set_axis_speed(world, differential.right, axis_r, wr + correction);
            }
            continue;
        }

        let denominator = il + ir + 4.0 * ic;
        if error.abs() <= EPSILON || denominator <= EPSILON { continue; }
        let impulse = -error / denominator;
        if !fixed_l { world.bodies[differential.left].apply_torque_impulse(axis_l * impulse, true); }
        if !fixed_r { world.bodies[differential.right].apply_torque_impulse(axis_r * impulse, true); }
        if !fixed_c { world.bodies[differential.carrier].apply_torque_impulse(axis_c * (-2.0 * impulse), true); }
    }
}

fn set_axis_speed(
    world: &mut PhysicsWorld,
    handle: RigidBodyHandle,
    axis: Vector,
    target: Real,
) {
    let body = &mut world.bodies[handle];
    if body.is_fixed() { return; }
    let angular = body.angvel();
    body.set_angvel(angular + axis * (target - angular.dot(axis)), true);
}
