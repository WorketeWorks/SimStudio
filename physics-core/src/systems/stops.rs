use std::collections::HashMap;

use rapier3d::prelude::*;

use crate::math::{normalized, vector};
use crate::model::AxialStopConfig;

#[derive(Clone, Copy)]
pub struct AxialStopRuntime {
    body_a: RigidBodyHandle,
    body_b: RigidBodyHandle,
    local_host_point: Vector,
    local_stop_point: Vector,
    local_axis_a: Vector,
    side: Real,
    minimum_distance: Real,
}

pub fn build(
    configs: &[AxialStopConfig],
    bodies: &HashMap<u32, RigidBodyHandle>,
    world: &PhysicsWorld,
) -> Vec<AxialStopRuntime> {
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
            Some(AxialStopRuntime {
                body_a,
                body_b,
                local_host_point: rigid_a
                    .position()
                    .inverse_transform_point(vector(config.host_point)),
                local_stop_point: rigid_b
                    .position()
                    .inverse_transform_point(vector(config.stop_point)),
                local_axis_a: rigid_a
                    .position()
                    .inverse_transform_vector(normalized(config.world_axis)),
                side: if config.side < 0.0 { -1.0 } else { 1.0 },
                minimum_distance: config.minimum_distance.max(0.0),
            })
        })
        .collect()
}

/// Prevents a bush or nut from being numerically pulled through the socket it
/// is resting against. This is a hard one-sided axial constraint.
pub fn enforce(stops: &[AxialStopRuntime], world: &mut PhysicsWorld) {
    for stop in stops {
        let body_a = &world.bodies[stop.body_a];
        let body_b = &world.bodies[stop.body_b];
        if body_b.is_fixed() {
            continue;
        }
        let host_point = body_a.position().transform_point(stop.local_host_point);
        let stop_point = body_b.position().transform_point(stop.local_stop_point);
        let axis = body_a.rotation() * stop.local_axis_a;
        let signed_distance = (stop_point - host_point).dot(axis) * stop.side;
        if signed_distance >= stop.minimum_distance {
            continue;
        }

        let correction = axis * (stop.side * (stop.minimum_distance - signed_distance));
        let next_translation = body_b.translation() + correction;
        let velocity_a = body_a.linvel();
        let velocity_b = body_b.linvel();
        let relative_axial = (velocity_b - velocity_a).dot(axis);

        let body_b = &mut world.bodies[stop.body_b];
        body_b.set_translation(next_translation, true);
        if relative_axial * stop.side < 0.0 {
            body_b.set_linvel(velocity_b - axis * relative_axial, true);
        }
    }
}
