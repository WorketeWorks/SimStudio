use std::collections::HashMap;

use rapier3d::prelude::*;

use crate::math::{normalized, vector};
use crate::model::{JointConfig, JointMode, PhysicsCommand, PhysicsSettings};

#[derive(Clone)]
pub struct JointRuntime {
    pub id: String,
    pub handle: ImpulseJointHandle,
    pub body_a: RigidBodyHandle,
    pub body_b: RigidBodyHandle,
    pub mode: JointMode,
    pub local_axis_a: Vector,
}

pub fn create_joint(
    config: &JointConfig,
    body_ids: &HashMap<u32, RigidBodyHandle>,
    world: &mut PhysicsWorld,
) -> Option<JointRuntime> {
    let body_a = *body_ids.get(&config.body_a)?;
    let body_b = *body_ids.get(&config.body_b)?;
    if body_a == body_b {
        return None;
    }

    let rigid_a = world.bodies.get(body_a)?;
    let rigid_b = world.bodies.get(body_b)?;
    let anchor_a = rigid_a
        .position()
        .inverse_transform_point(vector(config.world_anchor_a));
    let anchor_b = rigid_b
        .position()
        .inverse_transform_point(vector(config.world_anchor_b));
    let world_axis_a = normalized(config.world_axis_a);
    let world_axis_b = normalized(config.world_axis_b);
    let axis_a = rigid_a.position().inverse_transform_vector(world_axis_a);
    let axis_b = rigid_b.position().inverse_transform_vector(world_axis_b);

    let mut data = match config.mode {
        JointMode::Rotation | JointMode::Motor => {
            let mut data = GenericJointBuilder::new(JointAxesMask::LOCKED_REVOLUTE_AXES)
                .local_axis1(axis_a)
                .local_axis2(axis_b)
                .local_anchor1(anchor_a)
                .local_anchor2(anchor_b)
                .contacts_enabled(true)
                .build();
            data.set_contacts_enabled(true);
            let force = if config.mode == JointMode::Motor {
                config.motor_force
            } else {
                config.passive_motor_force
            };
            if force > 0.0 {
                data.set_motor_velocity(
                    JointAxis::AngX,
                    if config.mode == JointMode::Motor {
                        config.motor_speed
                    } else {
                        0.0
                    },
                    // Match the editor's historical Rapier control: the user
                    // force value also controls how aggressively the motor
                    // reaches its target instead of behaving like a soft servo.
                    force.max(0.01),
                )
                .set_motor_max_force(JointAxis::AngX, force);
            }
            data
        }
        JointMode::Linear => {
            let mut joint = PrismaticJoint::new(axis_a);
            joint
                .set_local_axis2(axis_b)
                .set_local_anchor1(anchor_a)
                .set_local_anchor2(anchor_b)
                .set_contacts_enabled(true);
            if !config.dynamic_axle {
                let limit = (config.travel * 0.5).max(0.15);
                joint.set_limits([-limit, limit]);
            }
            joint.data
        }
        JointMode::RotationLinear => GenericJointBuilder::new(
            JointAxesMask::LIN_Y
                | JointAxesMask::LIN_Z
                | JointAxesMask::ANG_Y
                | JointAxesMask::ANG_Z,
        )
        .local_anchor1(anchor_a)
        .local_anchor2(anchor_b)
        .local_axis1(axis_a)
        .local_axis2(axis_b)
        .contacts_enabled(true)
        .build(),
        JointMode::Fixed => {
            // Both frames use the current world orientation. This keeps forced
            // connections at their visual offset instead of teleporting them.
            let world_frame_a = Rotation::from_rotation_arc(Vector::X, world_axis_a);
            let world_frame_b = Rotation::from_rotation_arc(Vector::X, world_axis_b);
            let frame_a = Pose::from_parts(anchor_a, rigid_a.rotation().inverse() * world_frame_a);
            let frame_b = Pose::from_parts(anchor_b, rigid_b.rotation().inverse() * world_frame_b);
            FixedJointBuilder::new()
                .local_frame1(frame_a)
                .local_frame2(frame_b)
                .contacts_enabled(true)
                .build()
                .data
        }
    };

    data.set_contacts_enabled(true);
    let handle = world.impulse_joints.insert(body_a, body_b, data, true);

    Some(JointRuntime {
        id: config.id.clone(),
        handle,
        body_a,
        body_b,
        mode: config.mode,
        local_axis_a: axis_a,
    })
}

pub fn update_motors(
    commands: &[PhysicsCommand],
    joint_ids: &HashMap<String, usize>,
    joints: &[JointRuntime],
    world: &mut PhysicsWorld,
) {
    for command in commands {
        let PhysicsCommand::SetMotor {
            joint,
            speed,
            force,
        } = command
        else {
            continue;
        };
        let Some(runtime) = joint_ids.get(joint).and_then(|index| joints.get(*index)) else {
            continue;
        };
        let Some(revolute) = world
            .impulse_joints
            .get_mut(runtime.handle, true)
            .and_then(|joint| joint.data.as_revolute_mut())
        else {
            continue;
        };
        revolute
            .set_motor_velocity(*speed, (*force).max(0.01))
            .set_motor_max_force((*force).max(0.0));
    }
}

/// Applies the small user-configurable resistance of sliding axles. The joint
/// itself handles alignment; this system only damps motion along its free axis.
pub fn apply_axle_friction(
    joints: &[JointRuntime],
    world: &mut PhysicsWorld,
    settings: PhysicsSettings,
    timestep: f32,
) {
    for joint in joints {
        if joint.mode != JointMode::Linear && joint.mode != JointMode::RotationLinear {
            continue;
        }

        let Some(body_a) = world.bodies.get(joint.body_a) else {
            continue;
        };
        let Some(body_b) = world.bodies.get(joint.body_b) else {
            continue;
        };
        let axis = body_a.rotation() * joint.local_axis_a;
        let linear_a = body_a.linvel();
        let linear_b = body_b.linvel();
        let angular_a = body_a.angvel();
        let angular_b = body_b.angvel();
        let fixed_a = body_a.is_fixed();
        let fixed_b = body_b.is_fixed();

        let relative_speed = (linear_b - linear_a).dot(axis);
        let damping = settings.axle_sliding_friction
            * if joint.mode == JointMode::Linear {
                1.0
            } else {
                0.375
            };
        let impulse = axis * (relative_speed * damping).clamp(-0.35, 0.35) * timestep;
        if !fixed_a {
            world.bodies[joint.body_a].apply_impulse(impulse, true);
        }
        if !fixed_b {
            world.bodies[joint.body_b].apply_impulse(-impulse, true);
        }

        if joint.mode == JointMode::RotationLinear && settings.axle_rotation_friction > 0.0 {
            let relative_angular = (angular_b - angular_a).dot(axis);
            let torque = axis
                * (relative_angular * settings.axle_rotation_friction).clamp(-1.0, 1.0)
                * timestep;
            if !fixed_a {
                world.bodies[joint.body_a].apply_torque_impulse(torque, true);
            }
            if !fixed_b {
                world.bodies[joint.body_b].apply_torque_impulse(-torque, true);
            }
        }
    }
}
