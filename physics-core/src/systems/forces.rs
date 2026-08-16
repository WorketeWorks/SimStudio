use std::collections::HashMap;

use rapier3d::prelude::*;

use crate::math::quaternion;
use crate::math::{clamp_length, vector};
use crate::model::PhysicsCommand;

/// Applies all transient UI commands before Rapier advances. Commands contain
/// plain numbers, so JavaScript never owns or borrows a Rust/Rapier object.
pub fn apply_commands(
    commands: &[PhysicsCommand],
    bodies: &HashMap<u32, RigidBodyHandle>,
    world: &mut PhysicsWorld,
    timestep: f32,
) -> f32 {
    let mut max_spring_force: f32 = 0.0;

    for command in commands {
        match command {
            PhysicsCommand::Spring {
                body,
                world_point,
                target,
                stiffness,
                damping,
                max_force,
            } => {
                let Some(handle) = bodies.get(body) else {
                    continue;
                };
                let Some(rigid_body) = world.bodies.get_mut(*handle) else {
                    continue;
                };
                if rigid_body.is_fixed() {
                    continue;
                }

                let delta = clamp_length(vector(*target) - vector(*world_point), 3.5);
                let acceleration =
                    clamp_length(delta * *stiffness - rigid_body.linvel() * *damping, 180.0);
                // The editor only knows the nominal LEGO-piece mass, while
                // Rapier also includes every compound collider. Scale the cap
                // with Rapier's real mass so large mechanisms remain draggable.
                let mass = rigid_body.mass().max(0.25);
                let effective_max_force = (*max_force).max(mass * 180.0);
                let force = clamp_length(acceleration * mass, effective_max_force.max(0.0));
                max_spring_force = max_spring_force.max(force.length());
                rigid_body.apply_impulse_at_point(force * timestep, vector(*world_point), true);
            }
            PhysicsCommand::Impulse {
                body,
                impulse,
                world_point,
            } => {
                let Some(rigid_body) = bodies
                    .get(body)
                    .and_then(|handle| world.bodies.get_mut(*handle))
                else {
                    continue;
                };
                if let Some(point) = world_point {
                    rigid_body.apply_impulse_at_point(vector(*impulse), vector(*point), true);
                } else {
                    rigid_body.apply_impulse(vector(*impulse), true);
                }
            }
            PhysicsCommand::TorqueImpulse { body, impulse } => {
                if let Some(rigid_body) = bodies
                    .get(body)
                    .and_then(|handle| world.bodies.get_mut(*handle))
                {
                    rigid_body.apply_torque_impulse(vector(*impulse), true);
                }
            }
            PhysicsCommand::SetFixed { body, fixed } => {
                if let Some(rigid_body) = bodies
                    .get(body)
                    .and_then(|handle| world.bodies.get_mut(*handle))
                {
                    rigid_body.set_body_type(
                        if *fixed {
                            RigidBodyType::Fixed
                        } else {
                            RigidBodyType::Dynamic
                        },
                        true,
                    );
                }
            }
            PhysicsCommand::SetTranslation { body, position } => {
                if let Some(rigid_body) = bodies
                    .get(body)
                    .and_then(|handle| world.bodies.get_mut(*handle))
                {
                    rigid_body.set_translation(vector(*position), true);
                }
            }
            PhysicsCommand::SetRotation { body, rotation } => {
                if let Some(rigid_body) = bodies
                    .get(body)
                    .and_then(|handle| world.bodies.get_mut(*handle))
                {
                    rigid_body.set_rotation(quaternion(*rotation), true);
                }
            }
            PhysicsCommand::SetLinearVelocity { body, velocity } => {
                if let Some(rigid_body) = bodies
                    .get(body)
                    .and_then(|handle| world.bodies.get_mut(*handle))
                {
                    rigid_body.set_linvel(vector(*velocity), true);
                }
            }
            PhysicsCommand::SetAngularVelocity { body, velocity } => {
                if let Some(rigid_body) = bodies
                    .get(body)
                    .and_then(|handle| world.bodies.get_mut(*handle))
                {
                    rigid_body.set_angvel(vector(*velocity), true);
                }
            }
            PhysicsCommand::SetDamping {
                body,
                linear,
                angular,
            } => {
                if let Some(rigid_body) = bodies
                    .get(body)
                    .and_then(|handle| world.bodies.get_mut(*handle))
                {
                    rigid_body.set_linear_damping((*linear).max(0.0));
                    rigid_body.set_angular_damping((*angular).max(0.0));
                }
            }
            PhysicsCommand::SetMotor { .. } => {
                // Motor commands are handled by systems::joints because they
                // target an impulse-joint handle instead of a rigid body.
            }
        }
    }

    max_spring_force
}
