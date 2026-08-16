use rapier3d::prelude::*;

use crate::model::{Quat, Vec3};

#[inline]
pub fn vector(value: Vec3) -> Vector {
    Vector::new(value[0], value[1], value[2])
}

#[inline]
pub fn quaternion(value: Quat) -> Rotation {
    Rotation::from_xyzw(value[0], value[1], value[2], value[3]).normalize()
}

#[inline]
pub fn pose(position: Vec3, rotation: Quat) -> Pose {
    Pose::from_parts(vector(position), quaternion(rotation))
}

#[inline]
pub fn normalized(value: Vec3) -> Vector {
    vector(value).try_normalize().unwrap_or(Vector::X)
}

#[inline]
pub fn clamp_length(value: Vector, maximum: Real) -> Vector {
    let length = value.length();
    if length > maximum && length > 1.0e-8 {
        value * (maximum / length)
    } else {
        value
    }
}

#[inline]
pub fn rotation_to_array(rotation: &Rotation) -> Quat {
    [rotation.x, rotation.y, rotation.z, rotation.w]
}
