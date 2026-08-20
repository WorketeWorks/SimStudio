use std::collections::HashMap;

use rapier3d::prelude::*;

use crate::math::{normalized, vector};
use crate::model::GearConfig;

const VELOCITY_SOLVER_PASSES: usize = 16;
const VELOCITY_EPSILON: Real = 1.0e-6;
const GEOMETRY_EPSILON: Real = 1.0e-8;

// Numerical rest thresholds.
//
// 2e-5 rad/s is about 0.00019 RPM: one revolution would take more than
// 87 hours. Treating that as rest removes solver creep without affecting any
// practically intentional LEGO mechanism motion.
const REST_ANGULAR_SPEED: Real = 2.0e-5;
const REST_CONTACT_SPEED: Real = 2.0e-5;
const REST_LINEAR_SPEED: Real = 2.0e-5;

// Tooth phase lock.
// The correction acts as a velocity bias, never as a positional teleport.
const PHASE_BAUMGARTE: Real = 0.35;
const MAX_PHASE_CORRECTION_SPEED: Real = 1.0;

#[derive(Clone)]
pub struct GearRuntime {
    pub body_a: RigidBodyHandle,
    pub body_b: RigidBodyHandle,
    pub local_axis_a: Vector,
    pub local_axis_b: Vector,
    pub local_center_a: Vector,
    pub local_center_b: Vector,
    pub local_reference_a: Vector,
    pub local_reference_b: Vector,
    pub teeth_a: Real,
    pub signed_teeth_b: Real,
    pub phase_lock: bool,

    // These are kept for compatibility with the existing runtime/state.
    // Phase is no longer corrected by teleporting rigid bodies.
    pub angle_a: Real,
    pub angle_b: Real,
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
                local_reference_a: rigid_a
                    .position()
                    .inverse_transform_vector(normalized(config.reference_a)),
                local_reference_b: rigid_b
                    .position()
                    .inverse_transform_vector(normalized(config.reference_b)),
                teeth_a: config.teeth_a.max(1.0),
                signed_teeth_b: config.sign_b * config.teeth_b.max(1.0),
                phase_lock: config.phase_lock,
                angle_a: 0.0,
                angle_b: 0.0,
            })
        })
        .collect()
}

/// Projects every gear pair so the two tooth surfaces have the same
/// tangential velocity at their current contact point.
///
/// The old solver only constrained:
///
///     teeth_a * omega_a + teeth_b * omega_b = 0
///
/// That ignores translation of the gear centres. This version constrains the
/// actual velocity of the tooth contact:
///
///     v_contact = v_linear + omega x r
///
/// Therefore translating/orbiting a gear can drive its neighbour even when
/// the translating gear has little or no own angular velocity.
///
/// Forward/reverse sweeps reduce array-order bias in long gear trains.
pub fn project_velocities(gears: &[GearRuntime], world: &mut PhysicsWorld, dt: Real) {
    for _ in 0..VELOCITY_SOLVER_PASSES {
        for gear in gears {
            solve_gear_velocity(gear, world, dt);
        }

        for gear in gears.iter().rev() {
            solve_gear_velocity(gear, world, dt);
        }
    }

    // Once the constraint iterations have converged, remove only microscopic
    // axial velocities when the actual tooth contact is also effectively at
    // rest. This prevents a blocked train from creeping forever because of
    // floating-point/solver residue.
    //
    // It is deliberately done AFTER the regular solver passes so it never
    // replaces real transmission and it does not interfere with translating
    // or orbiting gears whose contact points are genuinely moving.
    for gear in gears {
        settle_near_rest(gear, world);
    }
}

fn solve_gear_velocity(
    gear: &GearRuntime,
    world: &mut PhysicsWorld,
    dt: Real,
) {
    let Some(body_a) = world.bodies.get(gear.body_a) else {
        return;
    };

    let Some(body_b) = world.bodies.get(gear.body_b) else {
        return;
    };

    let position_a = *body_a.position();
    let position_b = *body_b.position();

    let axis_a = position_a.rotation * gear.local_axis_a;
    let axis_b = position_b.rotation * gear.local_axis_b;

    let center_a = position_a.transform_point(gear.local_center_a);
    let center_b = position_b.transform_point(gear.local_center_b);

    let fixed_a = body_a.is_fixed();
    let fixed_b = body_b.is_fixed();

    if fixed_a && fixed_b {
        return;
    }

    let linear_a = body_a.linvel();
    let linear_b = body_b.linvel();

    let angular_a = body_a.angvel();
    let angular_b = body_b.angvel();

    let center_delta = center_b - center_a;

    let radial_a_raw =
        center_delta - axis_a * center_delta.dot(axis_a);

    let radial_b_raw =
        -center_delta - axis_b * (-center_delta).dot(axis_b);

    if radial_a_raw.length_squared() <= GEOMETRY_EPSILON
        || radial_b_raw.length_squared() <= GEOMETRY_EPSILON
    {
        solve_angular_ratio_fallback(
            gear,
            world,
            axis_a,
            axis_b,
            angular_a,
            angular_b,
            fixed_a,
            fixed_b,
        );

        return;
    }

    let radial_a = radial_a_raw.normalize();
    let radial_b = radial_b_raw.normalize();

    let tangent_a_raw = axis_a.cross(radial_a);
    let tangent_b_raw = axis_b.cross(radial_b);

    if tangent_a_raw.length_squared() <= GEOMETRY_EPSILON
        || tangent_b_raw.length_squared() <= GEOMETRY_EPSILON
    {
        solve_angular_ratio_fallback(
            gear,
            world,
            axis_a,
            axis_b,
            angular_a,
            angular_b,
            fixed_a,
            fixed_b,
        );

        return;
    }

    let tangent_a = tangent_a_raw.normalize();
    let mut tangent_b = tangent_b_raw.normalize();

    if tangent_a.dot(tangent_b) < 0.0 {
        tangent_b = -tangent_b;
    }

    let tangent_sum = tangent_a + tangent_b;

    let tangent =
        if tangent_sum.length_squared() > GEOMETRY_EPSILON {
            tangent_sum.normalize()
        } else {
            tangent_a
        };

    let distance = center_delta.length();

    if distance <= GEOMETRY_EPSILON {
        solve_angular_ratio_fallback(
            gear,
            world,
            axis_a,
            axis_b,
            angular_a,
            angular_b,
            fixed_a,
            fixed_b,
        );

        return;
    }

    let teeth_b =
        gear.signed_teeth_b.abs().max(1.0);

    let total_teeth =
        (gear.teeth_a + teeth_b).max(1.0);

    let perpendicular =
        axis_a.dot(axis_b).abs() < 0.2;

    /*
     * Para engranajes paralelos la distancia entre centros
     * es la suma de los radios de paso.
     *
     * Para bevel a 90º la distancia entre centros es diagonal,
     * por lo que usamos las proyecciones sobre el eje contrario.
     */
    let (radius_a, radius_b) = if perpendicular {
        (
            center_delta.dot(axis_b).abs(),
            center_delta.dot(axis_a).abs(),
        )
    } else {
        (
            distance * gear.teeth_a / total_teeth,
            distance * teeth_b / total_teeth,
        )
    };

    if radius_a <= GEOMETRY_EPSILON
        || radius_b <= GEOMETRY_EPSILON
    {
        return;
    }

    let contact_a =
        center_a + radial_a * radius_a;

    let contact_b =
        center_b + radial_b * radius_b;

    /*
     * Vector desde el origen del rigid body hasta
     * el punto de contacto.
     */
    let r_a =
        contact_a - position_a.translation;

    let r_b =
        contact_b - position_b.translation;

    /*
     * Velocidad real en el punto de contacto:
     *
     * v = v_lineal + ω × r
     */
    let point_velocity_a =
        linear_a + angular_a.cross(r_a);

    let point_velocity_b =
        linear_b + angular_b.cross(r_b);

    let velocity_a =
        point_velocity_a.dot(tangent);

    let velocity_b =
        point_velocity_b.dot(tangent);

    /*
     * ============================================================
     * BEVEL GEARS / EJES PERPENDICULARES
     * ============================================================
     *
     * En un diferencial necesitamos una reacción física real
     * en el punto de contacto.
     *
     * Si solamente cambiamos set_angvel(), el satélite puede girar
     * pero no empuja correctamente su pivote y por tanto no mueve
     * la carcasa.
     *
     * apply_impulse_at_point() genera:
     *
     * - cambio de velocidad lineal
     * - cambio de velocidad angular
     * - reacción a través de las articulaciones
     */
    if perpendicular {
        let contact_error =
            velocity_a - velocity_b;

        if contact_error.abs() < VELOCITY_EPSILON {
            return;
        }

        /*
         * project_velocities() ejecuta muchas pasadas,
         * así que usamos una corrección moderada.
         */
        let impulse_strength =
            (-contact_error * 0.12)
                .clamp(-0.5, 0.5);

        let impulse =
            tangent * impulse_strength;

        if !fixed_a {
            world.bodies[gear.body_a]
                .apply_impulse_at_point(
                    impulse,
                    contact_a,
                    true,
                );
        }

        if !fixed_b {
            world.bodies[gear.body_b]
                .apply_impulse_at_point(
                    -impulse,
                    contact_b,
                    true,
                );
        }

        return;
    }

    /*
     * ============================================================
     * ENGRANAJES PARALELOS
     * ============================================================
     */

    let surface_sign =
        if gear.signed_teeth_b < 0.0 {
            -1.0
        } else {
            1.0
        };

    let contact_error =
        velocity_a - surface_sign * velocity_b;

    /*
     * Tooth phase lock solo para engranajes paralelos.
     */
    let phase_bias =
        if gear.phase_lock && dt > 1.0e-6 {
            let reference_a_world =
                position_a.rotation
                    * gear.local_reference_a;

            let reference_b_world =
                position_b.rotation
                    * gear.local_reference_b;

            let reference_a_plane =
                reference_a_world
                    - axis_a
                        * reference_a_world.dot(axis_a);

            let reference_b_plane =
                reference_b_world
                    - axis_b
                        * reference_b_world.dot(axis_b);

            if reference_a_plane.length_squared()
                > GEOMETRY_EPSILON
                && reference_b_plane.length_squared()
                    > GEOMETRY_EPSILON
            {
                let ref_a =
                    reference_a_plane.normalize();

                let ref_b =
                    reference_b_plane.normalize();

                let angle_a =
                    signed_angle_around_axis(
                        ref_a,
                        radial_a,
                        axis_a,
                    );

                let angle_b =
                    signed_angle_around_axis(
                        ref_b,
                        radial_b,
                        axis_b,
                    );

                let phase_a =
                    wrap_pi(
                        gear.teeth_a * angle_a,
                    );

                let phase_b =
                    wrap_pi(
                        teeth_b * angle_b,
                    );

                let sign_b =
                    if gear.signed_teeth_b < 0.0 {
                        -1.0
                    } else {
                        1.0
                    };

                let phase_error =
                    wrap_pi(
                        phase_a
                            + sign_b * phase_b
                            - std::f32::consts::PI,
                    );

                let pitch_scale =
                    distance / total_teeth;

                (
                    phase_error
                        * pitch_scale
                        * PHASE_BAUMGARTE
                        / dt
                )
                    .clamp(
                        -MAX_PHASE_CORRECTION_SPEED,
                        MAX_PHASE_CORRECTION_SPEED,
                    )
            } else {
                0.0
            }
        } else {
            0.0
        };

    let error =
        contact_error - phase_bias;

    if error.abs() < VELOCITY_EPSILON {
        return;
    }

    /*
     * Cambio de velocidad tangencial provocado
     * por 1 rad/s de giro sobre cada eje.
     */
    let gain_a =
        axis_a.cross(r_a).dot(tangent);

    let gain_b =
        axis_b.cross(r_b).dot(tangent);

    let jacobian_a =
        if fixed_a {
            0.0
        } else {
            gain_a
        };

    let jacobian_b =
        if fixed_b {
            0.0
        } else {
            -surface_sign * gain_b
        };

    let denominator =
        jacobian_a * jacobian_a
            + jacobian_b * jacobian_b;

    if denominator <= GEOMETRY_EPSILON {
        solve_angular_ratio_fallback(
            gear,
            world,
            axis_a,
            axis_b,
            angular_a,
            angular_b,
            fixed_a,
            fixed_b,
        );

        return;
    }

    let lambda =
        -error / denominator;

    if !fixed_a {
        let delta_a =
            lambda * jacobian_a;

        world.bodies[gear.body_a]
            .set_angvel(
                angular_a
                    + axis_a * delta_a,
                true,
            );
    }

    if !fixed_b {
        let delta_b =
            lambda * jacobian_b;

        world.bodies[gear.body_b]
            .set_angvel(
                angular_b
                    + axis_b * delta_b,
                true,
            );
    }
}

/// Removes only numerical creep from a gear pair that has already converged to
/// an effectively stationary tooth contact.
///
/// This is not a general "minimum speed" clamp:
/// - both tooth contact speeds must already be tiny,
/// - relative centre translation must also be tiny,
/// - only the component around each gear axis is removed,
/// - any meaningful motion is left untouched.
///
/// As a result a translating/orbiting gear can still drive its neighbour, while
/// a fully blocked train settles to exact rest instead of accumulating a tiny
/// visible rotation over time.
fn settle_near_rest(gear: &GearRuntime, world: &mut PhysicsWorld) {
    let Some(body_a) = world.bodies.get(gear.body_a) else {
        return;
    };
    let Some(body_b) = world.bodies.get(gear.body_b) else {
        return;
    };

    let position_a = *body_a.position();
    let position_b = *body_b.position();

    let axis_a = position_a.rotation * gear.local_axis_a;
    let axis_b = position_b.rotation * gear.local_axis_b;

    let center_a = position_a.transform_point(gear.local_center_a);
    let center_b = position_b.transform_point(gear.local_center_b);
    let center_delta = center_b - center_a;

    if center_delta.length_squared() <= GEOMETRY_EPSILON {
        return;
    }

    let radial_a_raw = center_delta - axis_a * center_delta.dot(axis_a);
    let radial_b_raw = -center_delta - axis_b * (-center_delta).dot(axis_b);

    if radial_a_raw.length_squared() <= GEOMETRY_EPSILON
        || radial_b_raw.length_squared() <= GEOMETRY_EPSILON
    {
        return;
    }

    let radial_a = radial_a_raw.normalize();
    let radial_b = radial_b_raw.normalize();

    let tangent_a_raw = axis_a.cross(radial_a);
    let tangent_b_raw = axis_b.cross(radial_b);

    if tangent_a_raw.length_squared() <= GEOMETRY_EPSILON
        || tangent_b_raw.length_squared() <= GEOMETRY_EPSILON
    {
        return;
    }

    let tangent_a = tangent_a_raw.normalize();
    let mut tangent_b = tangent_b_raw.normalize();

    if tangent_a.dot(tangent_b) < 0.0 {
        tangent_b = -tangent_b;
    }

    let tangent_sum = tangent_a + tangent_b;
    let tangent = if tangent_sum.length_squared() > GEOMETRY_EPSILON {
        tangent_sum.normalize()
    } else {
        tangent_a
    };

    let distance = center_delta.length();

    if distance <= GEOMETRY_EPSILON {
        return;
    }

    let teeth_b = gear.signed_teeth_b.abs().max(1.0);
    let total_teeth = (gear.teeth_a + teeth_b).max(1.0);

    let perpendicular = axis_a.dot(axis_b).abs() < 0.2;

    let (radius_a, radius_b) = if perpendicular {
        // Bevel gears:
        // la distancia entre centros es diagonal, así que usamos
        // las componentes sobre los ejes opuestos.
        (
            center_delta.dot(axis_b).abs(),
            center_delta.dot(axis_a).abs(),
        )
    } else {
        // Spur / ejes paralelos.
        (
            distance * gear.teeth_a / total_teeth,
            distance * teeth_b / total_teeth,
        )
    };

    let contact_a = center_a + radial_a * radius_a;
    let contact_b = center_b + radial_b * radius_b;

    let r_a = contact_a - position_a.translation;
    let r_b = contact_b - position_b.translation;

    let linear_a = body_a.linvel();
    let linear_b = body_b.linvel();
    let angular_a = body_a.angvel();
    let angular_b = body_b.angvel();

    let point_velocity_a = linear_a + angular_a.cross(r_a);
    let point_velocity_b = linear_b + angular_b.cross(r_b);

    let contact_speed_a = point_velocity_a.dot(tangent).abs();
    let contact_speed_b = point_velocity_b.dot(tangent).abs();
    let relative_linear_speed = (linear_a - linear_b).dot(tangent).abs();

    if contact_speed_a > REST_CONTACT_SPEED
        || contact_speed_b > REST_CONTACT_SPEED
        || relative_linear_speed > REST_LINEAR_SPEED
    {
        return;
    }

    let fixed_a = body_a.is_fixed();
    let fixed_b = body_b.is_fixed();

    let axial_a = angular_a.dot(axis_a);
    let axial_b = angular_b.dot(axis_b);

    if !fixed_a && axial_a.abs() <= REST_ANGULAR_SPEED {
        world.bodies[gear.body_a].set_angvel(angular_a - axis_a * axial_a, true);
    }

    if !fixed_b && axial_b.abs() <= REST_ANGULAR_SPEED {
        world.bodies[gear.body_b].set_angvel(angular_b - axis_b * axial_b, true);
    }
}


fn signed_angle_around_axis(from: Vector, to: Vector, axis: Vector) -> Real {
    axis.dot(from.cross(to)).atan2(from.dot(to))
}

fn wrap_pi(value: Real) -> Real {
    let two_pi = std::f32::consts::TAU;
    (value + std::f32::consts::PI).rem_euclid(two_pi) - std::f32::consts::PI
}



/// Fallback for degenerate/coaxial contact geometry.
///
/// This is intentionally the old exact angular relationship, but unlike the
/// old phase solver it never changes positions directly.
fn solve_angular_ratio_fallback(
    gear: &GearRuntime,
    world: &mut PhysicsWorld,
    axis_a: Vector,
    axis_b: Vector,
    angular_a: Vector,
    angular_b: Vector,
    fixed_a: bool,
    fixed_b: bool,
) {
    if fixed_a && fixed_b {
        return;
    }

    let velocity_a = angular_a.dot(axis_a);
    let velocity_b = angular_b.dot(axis_b);

    let error = gear.teeth_a * velocity_a + gear.signed_teeth_b * velocity_b;

    if error.abs() < VELOCITY_EPSILON {
        return;
    }

    let (delta_a, delta_b) = if fixed_a {
        (0.0, -error / gear.signed_teeth_b)
    } else if fixed_b {
        (-error / gear.teeth_a, 0.0)
    } else {
        let denominator =
            gear.teeth_a * gear.teeth_a + gear.signed_teeth_b * gear.signed_teeth_b;

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

/// Keeps the legacy angle bookkeeping because PhysicsEngine already calls it.
///
/// The values are no longer used for a hard positional correction. Keeping the
/// bookkeeping makes this change isolated to gears.rs and avoids changing the
/// WASM protocol/runtime at the same time.
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

/// No hard phase projection.
///
/// The previous implementation called `set_position()` to rotate bodies back
/// into phase after Rapier had already solved the frame. When a gear was
/// blocked, that positional correction could fight joints/colliders and cause
/// visible snapping or "tooth skipping".
///
/// Tooth transmission is now handled continuously by `project_velocities()`.
/// A future phase stabilizer should add only a small velocity bias/impulse,
/// never teleport rigid bodies.
pub fn enforce_phase(_gears: &mut [GearRuntime], _world: &mut PhysicsWorld) {}
